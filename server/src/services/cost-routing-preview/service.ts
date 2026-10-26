import { createHash } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { activityLog, agents, companies, mimouseEvaluationComparisons, type Db } from "@paperclipai/db";
import { costRoutingPolicies as policies, costRoutingPreviews as previews } from "@paperclipai/db/schema/cost_routing_preview";
import { saveRoutingPolicySchema, createRoutingPreviewSchema } from "@paperclipai/shared/cost-routing-preview";
import { conflict, notFound } from "../../errors.js";
import { canonical } from "../mimouse-operations/preview.js";
import { routingConfigHash } from "./capture.js";
import { evaluateRoutingPreview } from "./evaluate.js";
const hash = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
const policyRecord = (row: typeof policies.$inferSelect) => ({ revision: row.revision, policy: row.policy, createdAt: row.createdAt.toISOString() });
const previewRecord = (row: typeof previews.$inferSelect) => ({ id: row.id, receiptHash: row.receiptHash, preview: row.preview });
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
async function lockCompany(tx: Tx, companyId: string) {
  const [company] = await tx.select({ status: companies.status }).from(companies).where(eq(companies.id, companyId)).for("update");
  if (!company) throw notFound("Company not found");
  return company;
}
async function audit(tx: Tx, companyId: string, actorId: string, id: string, action: string, revision: number, digest: string) {
  await tx.insert(activityLog).values({ companyId, actorType: "user", actorId, entityType: "cost_routing_preview",
    entityId: id, action, details: { revision, digest, dispatchAuthority: false, budgetReserved: false } });
}
export function costRoutingPreviewService(db: Db) {
  return {
    async current(companyId: string) {
      const [row] = await db.select().from(policies).where(eq(policies.companyId, companyId)).orderBy(desc(policies.revision)).limit(1);
      return row ? policyRecord(row) : null;
    },
    async getPreview(companyId: string, id: string) {
      const [row] = await db.select().from(previews).where(and(eq(previews.companyId, companyId), eq(previews.id, id)));
      if (!row) throw notFound("Preview not found");
      return previewRecord(row);
    },
    async save(companyId: string, actorId: string, raw: unknown) {
      const input = saveRoutingPolicySchema.parse(raw);
      input.policy.candidates.sort((a, b) => a.agentId.localeCompare(b.agentId));
      input.policy.requiredCapabilities.sort();
      const requestHash = hash({ actorId, input });
      return db.transaction(async tx => {
        await lockCompany(tx, companyId);
        const [retry] = await tx.select().from(policies).where(and(eq(policies.companyId, companyId), eq(policies.requestId, input.requestId)));
        if (retry) {
          if (retry.requestHash !== requestHash) throw conflict("Request ID reused with different input");
          return policyRecord(retry);
        }
        const [head] = await tx.select().from(policies).where(eq(policies.companyId, companyId)).orderBy(desc(policies.revision)).limit(1);
        if ((head?.revision ?? 0) !== input.expectedRevision) throw conflict("Policy changed; reload before saving");
        const ownedAgents = await tx.select({ id: agents.id }).from(agents).where(and(eq(agents.companyId, companyId), inArray(agents.id, input.policy.candidates.map(c => c.agentId))));
        const reportIds = [...new Set(input.policy.candidates.map(c => c.reportId))];
        const ownedReports = await tx.select({ id: mimouseEvaluationComparisons.id }).from(mimouseEvaluationComparisons)
          .where(and(eq(mimouseEvaluationComparisons.companyId, companyId), inArray(mimouseEvaluationComparisons.id, reportIds)));
        if (ownedAgents.length !== input.policy.candidates.length || ownedReports.length !== reportIds.length) throw notFound("Company candidate or report not found");
        const [row] = await tx.insert(policies).values({ companyId, revision: input.expectedRevision + 1,
          requestId: input.requestId, requestHash, policy: input.policy, actorId }).returning();
        await audit(tx, companyId, actorId, row!.id, "cost_routing.policy_saved", row!.revision, hash(input.policy));
        return policyRecord(row!);
      });
    },
    async preview(companyId: string, actorId: string, raw: unknown) {
      const input = createRoutingPreviewSchema.parse(raw), requestHash = hash({ actorId, input });
      return db.transaction(async tx => {
        const company = await lockCompany(tx, companyId);
        const [retry] = await tx.select().from(previews).where(and(eq(previews.companyId, companyId), eq(previews.requestId, input.requestId)));
        if (retry) {
          if (retry.requestHash !== requestHash) throw conflict("Request ID reused with different input");
          return previewRecord(retry);
        }
        const [policy] = await tx.select().from(policies).where(eq(policies.companyId, companyId)).orderBy(desc(policies.revision)).limit(1);
        if (!policy || policy.revision !== input.policyRevision) throw conflict("Current policy revision required");
        // Load config only on the server; project exactly model/adapter/status. Never
        // return, log, or copy raw configs into receipts or activity payloads.
        const ownedAgents = await tx.select({ id: agents.id, status: agents.status, lifecycleState: agents.lifecycleState,
          adapterType: agents.adapterType, config: agents.adapterConfig, runtimeConfig: agents.runtimeConfig }).from(agents)
          .where(and(eq(agents.companyId, companyId), inArray(agents.id, policy.policy.candidates.map(c => c.agentId))));
        const reports = await tx.select().from(mimouseEvaluationComparisons).where(and(eq(mimouseEvaluationComparisons.companyId, companyId),
          inArray(mimouseEvaluationComparisons.id, policy.policy.candidates.map(c => c.reportId))));
        const evidence = policy.policy.candidates.map(candidate => {
          const agent = ownedAgents.find(a => a.id === candidate.agentId), report = reports.find(r => r.id === candidate.reportId);
          const runs = report?.evidenceSnapshot.runs;
          const executionContextHashes = Array.isArray(runs) ? runs.filter(run => run && typeof run === "object" && "versionId" in run && run.versionId === report?.candidateVersionId).map(run => {
            if (!run || typeof run !== "object" || !("executionContextHash" in run)) return "";
            return typeof run.executionContextHash === "string" ? run.executionContextHash : "";
          }) : [];
          return { agentId: candidate.agentId, available: !!agent && ["idle", "running"].includes(agent.status) && agent.lifecycleState === "ready",
            adapterType: agent?.adapterType ?? "", configuredModel: typeof agent?.config.model === "string" ? agent.config.model : null,
            configHash: agent ? routingConfigHash({ adapterType: agent.adapterType, adapterConfig: agent.config, runtimeConfig: agent.runtimeConfig }) : null,
            routingEvidenceV1: report?.evidenceSnapshot.routingEvidenceV1, report: report?.report ?? null, createdAt: report?.createdAt.toISOString() ?? null, executionContextHashes };
        });
        const preview = evaluateRoutingPreview(companyId, policy.revision, policy.policy, evidence, company.status === "active", new Date());
        const receiptHash = hash(preview);
        const [row] = await tx.insert(previews).values({ companyId, policyRevision: policy.revision, requestId: input.requestId,
          requestHash, preview, receiptHash, actorId }).returning();
        await audit(tx, companyId, actorId, row!.id, "cost_routing.preview_recorded", policy.revision, receiptHash);
        return previewRecord(row!);
      });
    },
  };
}
