import { createHash } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { costEvents, heartbeatRuns, runUsageReceipts, type Db, type companySkillTestRuns } from "@paperclipai/db";
import { qualifyRoutingCapture } from "./proof.js";
import { type RoutingEvidenceV1 } from "@paperclipai/shared/cost-routing-preview";
import { canonical } from "../mimouse-operations/preview.js";
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
const hash = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
export const routingConfigHash = (snapshot: Record<string, unknown>) => hash({
  adapterType: snapshot.adapterType, adapterConfig: snapshot.adapterConfig, runtimeConfig: snapshot.runtimeConfig,
});
export async function captureRoutingEvidence(tx: Tx, companyId: string,
  candidateRuns: Array<typeof companySkillTestRuns.$inferSelect>): Promise<RoutingEvidenceV1 | null> {
  if (!candidateRuns.length || candidateRuns.length > 100 || candidateRuns.some(r => r.status !== "succeeded" || r.supersededAt || r.deletedAt || !r.inputId)) return null;
  const costs = await tx.select({ id: costEvents.id, issueId: costEvents.issueId, companyId: costEvents.companyId,
    agentId: costEvents.agentId, heartbeatRunId: costEvents.heartbeatRunId, model: costEvents.model, provider: costEvents.provider,
    billingType: costEvents.billingType, costStatus: costEvents.costStatus, amount: sql<string>`${costEvents.costCents}::text` }).from(costEvents).where(and(eq(costEvents.companyId, companyId), inArray(costEvents.issueId, candidateRuns.map(r => r.issueId)))).limit(101);
  if (costs.length > 100) return null;
  const runs = await tx.select({ id: heartbeatRuns.id, companyId: heartbeatRuns.companyId, agentId: heartbeatRuns.agentId,
    issueId: heartbeatRuns.issueId, status: heartbeatRuns.status, costAccountingPending: heartbeatRuns.costAccountingPending,
    costAccountedAt: heartbeatRuns.costAccountedAt, finishedAt: heartbeatRuns.finishedAt, usageJson: heartbeatRuns.usageJson })
    .from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, companyId), inArray(heartbeatRuns.issueId, candidateRuns.map(r => r.issueId)))).limit(101);
  if (runs.length > 100) return null;
  const receiptIds = runs.flatMap(run => typeof run.usageJson?.accountingReceiptId === "string" ? [run.usageJson.accountingReceiptId] : []);
  if (!receiptIds.length || receiptIds.some(id => !/^[a-f0-9-]{36}$/.test(id))) return null;
  const receipts = await tx.select({ id: runUsageReceipts.id, companyId: runUsageReceipts.companyId, runId: runUsageReceipts.runId,
    receiptHash: runUsageReceipts.receiptHash, complete: runUsageReceipts.complete, receiptJson: runUsageReceipts.receiptJson }).from(runUsageReceipts)
    .where(and(eq(runUsageReceipts.companyId, companyId), inArray(runUsageReceipts.id, receiptIds)));
  return qualifyRoutingCapture(companyId, candidateRuns.map(row => ({ caseId: row.inputId!, skillRunId: row.id,
    companyId: row.companyId, agentId: row.agentId, issueId: row.issueId, configHash: routingConfigHash(row.agentConfigSnapshot),
    executionContextHash: hash({ agent: row.agentConfigSnapshot, template: row.templateBody }),
    costs: costs.filter(c => c.issueId === row.issueId).map(c => ({ ...c, costCents: String(c.amount) })), heartbeats: runs, receipts })));
}
