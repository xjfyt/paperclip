import { createHash } from "node:crypto";
import { and, desc, eq, gt } from "drizzle-orm";
import { activityLog, companies, capabilityEvidence, type Db } from "@paperclipai/db";
import { appendCapabilityEvidenceSchema, capabilityBaseline, sameEvidenceContext, type CapabilityEvidenceEvent } from "@paperclipai/shared/capability-evidence";
import { conflict, notFound, unprocessable } from "../errors.js";

function present(row: typeof capabilityEvidence.$inferSelect): CapabilityEvidenceEvent {
  const { idempotencyKey: _key, requestHash: _hash, ...event } = row;
  return { ...event, createdAt: row.createdAt.toISOString() };
}
export function capabilityEvidenceService(db: Db) {
  return {
    async list(companyId: string, afterRevision = 0) {
      const rows = await db.select().from(capabilityEvidence).where(and(
        eq(capabilityEvidence.companyId, companyId), gt(capabilityEvidence.revision, afterRevision),
      )).orderBy(capabilityEvidence.revision).limit(101);
      return { events: rows.slice(0, 100).map(present), nextRevision: rows.length > 100 ? rows[99].revision : null };
    },
    async append(companyId: string, reviewerId: string, raw: unknown) {
      const input = appendCapabilityEvidenceSchema.parse(raw);
      // Parsed keys have canonical order. Actor is bound to the retry identity.
      const hash = createHash("sha256").update(JSON.stringify({ reviewerId, input })).digest("hex");
      return db.transaction(async tx => {
        const company = await tx.select({ id: companies.id }).from(companies)
          .where(eq(companies.id, companyId)).for("update");
        if (!company.length) throw notFound("Company not found");
        const [retry] = await tx.select().from(capabilityEvidence).where(and(
          eq(capabilityEvidence.companyId, companyId), eq(capabilityEvidence.idempotencyKey, input.idempotencyKey),
        ));
        if (retry) {
          if (retry.requestHash !== hash) throw conflict("Idempotency key already used for a different request");
          return present(retry);
        }
        const [head] = await tx.select({ revision: capabilityEvidence.revision }).from(capabilityEvidence)
          .where(eq(capabilityEvidence.companyId, companyId)).orderBy(desc(capabilityEvidence.revision)).limit(1);
        const revision = head?.revision ?? 0;
        if (revision !== input.expectedRevision) throw conflict("Evidence ledger changed; reload before recording", { revision });
        if (input.receipt) {
          if (capabilityBaseline(input.receipt.adapterType, input.receipt.capability) !== "C2") {
            throw unprocessable("Only implemented C2 capabilities can receive manual attestations");
          }
          if (Date.parse(input.receipt.testedAt) > Date.now() || Date.parse(input.receipt.expiresAt) <= Date.now()) {
            throw unprocessable("Evidence must be tested in the past and not expired");
          }
        }
        if (input.targetId) {
          const [target] = await tx.select().from(capabilityEvidence).where(and(
            eq(capabilityEvidence.companyId, companyId), eq(capabilityEvidence.id, input.targetId),
          ));
          if (!target?.receipt) throw notFound("Receipt not found in this company");
          const [retired] = await tx.select({ id: capabilityEvidence.id }).from(capabilityEvidence).where(and(
            eq(capabilityEvidence.companyId, companyId), eq(capabilityEvidence.targetId, input.targetId),
          )).limit(1);
          if (retired) throw conflict("Receipt already revoked or superseded");
          if (input.receipt && !sameEvidenceContext(target.receipt, input.receipt)) {
            throw unprocessable("Supersession requires the same exact evidence context");
          }
        }
        const [event] = await tx.insert(capabilityEvidence).values({
          companyId, reviewerId, revision: revision + 1, idempotencyKey: input.idempotencyKey,
          requestHash: hash, action: input.action, targetId: input.targetId ?? null,
          receipt: input.receipt ?? null, reason: input.reason,
        }).returning();
        // Direct insert: audit is in the same transaction, with no pre-commit publication.
        // Deliberately exclude aliases, external references and receipt contents from the audit payload.
        await tx.insert(activityLog).values({
          companyId, actorType: "user", actorId: reviewerId, action: `capability_evidence.${input.action}`,
          entityType: "capability_evidence", entityId: event.id,
          details: { revision: event.revision, targetId: event.targetId, evidenceKind: "operator_attestation" },
        });
        return present(event);
      });
    },
  };
}
