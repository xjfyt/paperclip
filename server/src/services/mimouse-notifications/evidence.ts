import { createHash } from "node:crypto";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { activityLog, companies, companySecrets, companySecretVersions, companySecretProviderConfigs, capabilityEvidence,
  approvals, mimouseNotificationEndpoints as endpoints, type Db } from "@paperclipai/db";
import { appendNotificationEvidenceSchema, isNotificationReceipt, sameNotificationScope, sameNotificationEvidenceContext, type NotificationEvidenceEvent,
  type NotificationEvidencePage, type NotificationEvidenceReceipt } from "@paperclipai/shared/notification-evidence";
import { conflict, notFound, unprocessable } from "../../errors.js";
import { notificationScope, notificationVerification } from "./verification.js";
const present = (row: typeof capabilityEvidence.$inferSelect): NotificationEvidenceEvent => ({
  id: row.id, companyId: row.companyId, revision: row.revision, action: row.action, targetId: row.targetId,
  receipt: isNotificationReceipt(row.receipt) ? row.receipt : null, reason: row.reason, reviewerId: row.reviewerId, createdAt: row.createdAt.toISOString(),
});
export function notificationEvidence(db: Db) {
  return {
    async list(companyId: string, endpointId: string, afterRevision = 0): Promise<NotificationEvidencePage> {
      const [endpoint] = await db.select({ id: endpoints.id }).from(endpoints).where(and(eq(endpoints.companyId, companyId), eq(endpoints.id, endpointId)));
      if (!endpoint) throw notFound("Notification endpoint not found");
      const rows = await db.select().from(capabilityEvidence).where(and(eq(capabilityEvidence.companyId, companyId), gt(capabilityEvidence.revision, afterRevision), sql`(
        (${capabilityEvidence.receipt}->>'domain' = 'notification' AND ${capabilityEvidence.receipt}->'scope'->>'endpointId' = ${endpointId}) OR
        (${capabilityEvidence.receipt} IS NULL AND EXISTS (SELECT 1 FROM capability_evidence target WHERE target.id = ${capabilityEvidence.targetId}
          AND target.company_id = ${companyId} AND target.receipt->>'domain' = 'notification' AND target.receipt->'scope'->>'endpointId' = ${endpointId}))
      )`)).orderBy(capabilityEvidence.revision).limit(101);
      const [head] = await db.select({ revision: capabilityEvidence.revision }).from(capabilityEvidence).where(eq(capabilityEvidence.companyId, companyId)).orderBy(desc(capabilityEvidence.revision)).limit(1);
      return { events: rows.slice(0, 100).map(present), nextRevision: rows.length > 100 ? rows[99].revision : null, headRevision: head?.revision ?? 0 };
    },
    async append(companyId: string, endpointId: string, reviewerId: string, raw: unknown) {
      const input = appendNotificationEvidenceSchema.parse(raw);
      // Zod's strict parsed shape canonicalizes keys. Existing adapter hash code is untouched.
      const hash = createHash("sha256").update(JSON.stringify({ endpointId, reviewerId, input })).digest("hex");
      return db.transaction(async tx => {
        const database = tx as unknown as Db;
        const company = await tx.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId)).for("update");
        if (!company.length) throw notFound("Company not found");
        const [retry] = await tx.select().from(capabilityEvidence).where(and(eq(capabilityEvidence.companyId, companyId), eq(capabilityEvidence.idempotencyKey, input.idempotencyKey)));
        if (retry) { if (retry.requestHash !== hash) throw conflict("Idempotency key already used for a different request"); return present(retry); }
        const [head] = await tx.select({ revision: capabilityEvidence.revision }).from(capabilityEvidence).where(eq(capabilityEvidence.companyId, companyId)).orderBy(desc(capabilityEvidence.revision)).limit(1);
        if ((head?.revision ?? 0) !== input.expectedRevision) throw conflict("Evidence ledger changed; reload before recording");
        // First read locates the credential. Do not lock endpoint before its credential:
        // security-change triggers hold secret/provider/version then update endpoint.
        const [initial] = await tx.select().from(endpoints).where(and(eq(endpoints.companyId, companyId), eq(endpoints.id, endpointId)));
        if (!initial) throw notFound("Notification endpoint not found");
        const [secretLocation] = await tx.select({ provider: companySecrets.provider, providerConfigId: companySecrets.providerConfigId }).from(companySecrets)
          .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.id, initial.secretRef)));
        if (secretLocation?.provider !== "local_encrypted") await tx.select({ id: companySecretProviderConfigs.id }).from(companySecretProviderConfigs).where(and(
          eq(companySecretProviderConfigs.companyId, companyId), eq(companySecretProviderConfigs.provider, secretLocation?.provider ?? ""),
          secretLocation?.providerConfigId ? eq(companySecretProviderConfigs.id, secretLocation.providerConfigId) : eq(companySecretProviderConfigs.isDefault, true),
        )).for("update");
        const [secret] = await tx.select({ provider: companySecrets.provider, providerConfigId: companySecrets.providerConfigId }).from(companySecrets)
          .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.id, initial.secretRef))).for("update");
        if (secret?.provider !== secretLocation?.provider || secret?.providerConfigId !== secretLocation?.providerConfigId) throw conflict("Credential binding changed; reload");
        await tx.select({ id: companySecretVersions.id }).from(companySecretVersions).where(and(eq(companySecretVersions.secretId, initial.secretRef), eq(companySecretVersions.version, initial.secretVersion))).for("update");
        const [endpoint] = await tx.select().from(endpoints).where(and(eq(endpoints.companyId, companyId), eq(endpoints.id, endpointId))).for("update");
        if (!endpoint || !sameNotificationScope(notificationScope(initial), notificationScope(endpoint)) || endpoint.configVersion !== input.expectedConfigVersion || endpoint.verificationEpoch !== input.expectedEpoch)
          throw conflict("Notification configuration or credential changed; reload");
        let target: typeof capabilityEvidence.$inferSelect | undefined;
        if (input.targetId) {
          [target] = await tx.select().from(capabilityEvidence).where(and(eq(capabilityEvidence.companyId, companyId), eq(capabilityEvidence.id, input.targetId)));
          if (!target || !isNotificationReceipt(target.receipt) || target.receipt.scope.endpointId !== endpointId) throw notFound("Notification receipt not found in this endpoint");
          const [retired] = await tx.select({ id: capabilityEvidence.id }).from(capabilityEvidence).where(and(eq(capabilityEvidence.companyId, companyId), eq(capabilityEvidence.targetId, input.targetId))).limit(1);
          if (retired) throw conflict("Receipt already revoked or superseded");
        }
        let receipt: NotificationEvidenceReceipt | null = null;
        if (input.receipt) {
          const claim = input.receipt;
          if (Date.parse(claim.testedAt) > Date.now() || Date.parse(claim.expiresAt) <= Date.now()) throw unprocessable("Evidence must be tested in the past and not expired");
          const view = await notificationVerification(database).read(companyId, endpointId);
          if (view.credentialStatus !== "metadata_active") throw unprocessable("Pinned credential metadata is unavailable or mutable");
          let resourceId: string | null = null;
          if (claim.category !== "protocol_report") {
            const observation = claim.category === "approval_scenario" ? view.latestApproval : view.latestTest;
            if (!observation || !observation.scopeMatches || observation.id !== claim.deliveryId || observation.review?.id !== claim.reviewId)
              throw unprocessable("Evidence must reference the latest matching delivery and human review");
            if (observation.state !== claim.expectedState || observation.attempt !== claim.expectedAttempt
              || observation.review.observedState !== observation.state || observation.review.observedAttempt !== observation.attempt) throw conflict("Delivery or human review changed; reload");
            if (claim.result === "passed" && observation.review.outcome !== "accepted") throw unprocessable("A passing declaration requires a reported accepted observation");
            if (Date.parse(claim.testedAt) < Date.parse(observation.createdAt)) throw unprocessable("Evidence predates its delivery");
            if (claim.category === "approval_scenario") {
              resourceId = observation.resourceId;
              if (!resourceId || observation.eventId !== `approval:${resourceId}`) throw unprocessable("Approval scenario requires the original business notification");
              const [approval] = await tx.select({ id: approvals.id }).from(approvals).where(and(eq(approvals.companyId, companyId), eq(approvals.id, resourceId)));
              if (!approval) throw notFound("Approval resource not found in this company");
            }
          }
          receipt = { ...claim, domain: "notification", scope: view.scope, resourceId, manual: true, machineVerified: false };
          if (target && isNotificationReceipt(target.receipt) && !sameNotificationEvidenceContext(target.receipt, receipt)) throw unprocessable("Supersession requires the same exact notification context");
        }
        const [event] = await tx.insert(capabilityEvidence).values({ companyId, reviewerId, revision: input.expectedRevision + 1,
          idempotencyKey: input.idempotencyKey, requestHash: hash, action: input.action, targetId: input.targetId ?? null, receipt, reason: input.reason }).returning();
        await tx.insert(activityLog).values({ companyId, actorType: "user", actorId: reviewerId, action: `notification.verification.${input.action}`,
          entityType: "notification_endpoint", entityId: endpointId, details: { evidenceId: event.id, revision: event.revision, configVersion: endpoint.configVersion, verificationEpoch: endpoint.verificationEpoch, evidenceKind: "operator_attestation" } });
        return present(event);
      });
    },
  };
}
