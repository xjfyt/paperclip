import { usdToUnits, centsToUnits, unitsToCents } from "@paperclipai/shared/money";
import { routingEvidenceV1Schema, type RoutingEvidenceV1 } from "@paperclipai/shared/cost-routing-preview";
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
export interface RoutingCaptureCase {
  caseId: string; skillRunId: string; companyId: string; agentId: string; adapterType: string; issueId: string;
  configHash: string; executionContextHash: string;
  costs: Array<{ id: string; companyId: string; agentId: string | null; heartbeatRunId: string | null;
    model: string; provider: string; billingType: string; costStatus: string; costCents: string }>;
  heartbeats: Array<{ id: string; companyId: string; agentId: string; issueId: string | null; status: string;
    dispatchedAdapterType: string | null; costAccountingPending: boolean; costAccountedAt: Date | null; finishedAt: Date | null; usageJson: unknown }>;
  receipts: Array<{ id: string; companyId: string; runId: string; receiptHash: string; complete: boolean; receiptJson: unknown }>;
}
/** Accounting diagnostics only, not proof that the pre-wake context executed.
 * Intentionally narrow: one accounted heartbeat/one final USD receipt per case.
 * Aggregates, multiple attempts/models, credits, estimates and partial receipts
 * are not interchangeable; they fail closed rather than becoming cheap/free. */
export function qualifyRoutingCapture(companyId: string, rows: RoutingCaptureCase[]): RoutingEvidenceV1 | null {
  if (!rows.length || rows.length > 100 || new Set(rows.map(r => r.caseId)).size !== rows.length) return null;
  let total = 0n, oldest = Infinity, newest = -Infinity; const cases: RoutingEvidenceV1["cases"] = [];
  let identity: { agentId: string; adapterType: string; provider: string; model: string; configHash: string } | null = null;
  try {
    for (const row of rows) {
      if (row.companyId !== companyId || row.costs.length !== 1) return null;
      const cost = row.costs[0]!;
      const issueRuns = row.heartbeats.filter(r => r.issueId === row.issueId);
      if (issueRuns.length !== 1) return null;
      const run = issueRuns.find(r => r.id === cost.heartbeatRunId);
      if (!run || cost.companyId !== companyId || cost.agentId !== row.agentId || run.companyId !== companyId
        || run.dispatchedAdapterType !== row.adapterType || run.agentId !== row.agentId || run.issueId !== row.issueId || run.status !== "succeeded"
        || run.costAccountingPending || !run.costAccountedAt || !run.finishedAt
        || cost.billingType !== "metered_api" || cost.costStatus !== "reported" || cost.model === "unknown" || cost.provider === "unknown") return null;
      const usage = object(run.usageJson);
      const receipt = row.receipts.find(r => r.id === usage.accountingReceiptId);
      if (!receipt || !receipt.complete || receipt.companyId !== companyId || receipt.runId !== run.id
        || usage.accountingCaptureFailed === true || usage.accountingReceiptReady !== true) return null;
      const envelope = object(receipt.receiptJson), part = object(envelope.receipt), pricing = object(part.pricingProvenance);
      // USD is explicit in the adapter accounting contract, not inferred from
      // numeric ledger cents or a caller-provided currency label.
      if (envelope.adapterType !== row.adapterType || envelope.schema !== "paperclip/accounting-receipt/v1" || envelope.companyId !== companyId || envelope.runId !== run.id
        || part.complete !== true || part.usageBasis !== "per_run" || part.model !== cost.model || part.provider !== cost.provider
        || !["api", "metered_api"].includes(String(part.billingType)) || part.costStatus !== "reported"
        || pricing.source !== "provider_reported" || (part.currency !== undefined && part.currency !== "USD")
        || part.usageByModel != null || part.cacheAdjustedCostUsd != null) return null;
      const amount = part.costUsdExact ?? part.costUsd;
      if ((typeof amount !== "string" && typeof amount !== "number") || String(amount).startsWith("-")) return null;
      const units = usdToUnits(amount);
      if (units < 0n || units !== centsToUnits(cost.costCents)) return null;
      const next = { agentId: row.agentId, adapterType: row.adapterType, provider: cost.provider, model: cost.model, configHash: row.configHash };
      if (identity && JSON.stringify(identity) !== JSON.stringify(next)) return null;
      identity = next; total += units; oldest = Math.min(oldest, run.finishedAt.getTime()); newest = Math.max(newest, run.finishedAt.getTime());
      cases.push({ caseId: row.caseId, skillRunId: row.skillRunId, heartbeatRunId: run.id, costEventId: cost.id,
        receiptId: receipt.id, receiptHash: receipt.receiptHash, executionContextHash: row.executionContextHash });
    }
    if (!identity) return null;
    return routingEvidenceV1Schema.parse({ version: 1, executionContextVerification: "unverified_test_creation_snapshot", companyId, ...identity, currency: "USD", unit: "cent", costCents: unitsToCents(total),
      basis: "accounted_per_run_provider_reported_usd", oldestFinishedAt: new Date(oldest).toISOString(), newestFinishedAt: new Date(newest).toISOString(), cases });
  } catch { return null; }
}
