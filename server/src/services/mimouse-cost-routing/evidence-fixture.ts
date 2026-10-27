import { comparisonFixture, comparisonId as id } from "../mimouse-private-prompt-tests/comparison-fixture.js";
import { comparePrivatePromptEvidence } from "../mimouse-private-prompt-tests/compare.js";
import { receiptFingerprint } from "../receipt-fingerprint.js";
import { runtimeRoutingProfileHash, type RuntimeRoutingEvidenceSource } from "./evidence.js";
export const evidenceNow = new Date("2026-10-27T00:00:00Z");
/** Inert rows only; production producer coverage is in the private CLI fixture. */
export async function routingEvidenceFixture(): Promise<RuntimeRoutingEvidenceSource> {
  const comparison = comparisonFixture();
  const report = await comparePrivatePromptEvidence(comparison), row = comparison.tests[1];
  const startedAt = new Date(evidenceNow.getTime() - 4000), spawnedAt = new Date(evidenceNow.getTime() - 3000);
  const receivedAt = new Date(evidenceNow.getTime() - 2000), finishedAt = new Date(evidenceNow.getTime() - 1000);
  row.spawnedAt = spawnedAt;
  const model = row.approvalSnapshot!.model, usage = { inputTokens: 4, cachedInputTokens: 1, outputTokens: 2 };
  Object.assign(row.privateResult!.resultJson!, { total_cost_usd: 0.00125,
    modelUsage: { [model]: { inputTokens: 3, cacheCreationInputTokens: 1, cacheReadInputTokens: 1, outputTokens: 2, costUSD: 0.00125 } } });
  const pricingProvenance = { source: "provider_reported", version: "claude-cli/private-prompt/v1" };
  const envelope = { schema: "paperclip/accounting-receipt/v1", id: id(82), companyId: row.companyId, runId: row.heartbeatRunId!,
    sourceId: id(83), sequence: 1, receivedAt: receivedAt.toISOString(), adapterType: "claude_local",
    receipt: { complete: true, usageBasis: "per_run", provider: "anthropic", biller: "anthropic", billingType: "api", model,
      costStatus: "reported", costUsd: 0.00125, usage, pricingProvenance } };
  const receipt = { id: envelope.id, companyId: row.companyId, runId: row.heartbeatRunId!, sourceId: envelope.sourceId, sequence: 1,
    receiptHash: receiptFingerprint(envelope), complete: true, receiptJson: envelope, receivedAt };
  return { comparison, candidate: { agentId: row.agentId, promptId: row.promptId, applicationId: id(90), applicationGeneration: 1, comparison: comparison.input },
    currentProfileHash: runtimeRoutingProfileHash(row.approvalSnapshot, row.secretValueHash),
    wakes: [{ id: row.wakeupRequestId!, companyId: row.companyId, agentId: row.agentId, runId: row.heartbeatRunId!, status: "completed",
      source: "on_demand", reason: "private_prompt_test", requestedByActorType: "user", requestedByActorId: row.actorUserId, idempotencyKey: `private-prompt-test:${row.id}` }],
    accounting: [{ companyId: row.companyId, agentId: row.agentId, adapterType: "claude_local", caseId: row.caseId, skillRunId: row.id,
      issueId: row.issueId!, configHash: row.configDigest, executionContextHash: report.contextHash, receipts: [receipt],
      costs: [{ id: id(81), companyId: row.companyId, agentId: row.agentId, heartbeatRunId: row.heartbeatRunId!, issueId: row.issueId!,
        model, provider: "anthropic", biller: "anthropic", billingType: "metered_api", costStatus: "reported", costCents: "0.1250000",
        reportedCostCents: "0.1250000", pricingProvenance, idempotencyKey: `heartbeat:${row.heartbeatRunId}:final`, ...usage, occurredAt: finishedAt }],
      heartbeats: [{ id: row.heartbeatRunId!, companyId: row.companyId, agentId: row.agentId, issueId: row.issueId!,
        status: "succeeded", dispatchedAdapterType: "claude_local", costAccountingPending: false, costAccountedAt: evidenceNow,
        accountingProjectionVersion: "v2", startedAt, finishedAt, usageJson: { ...usage, model, provider: "anthropic", billingType: "metered_api",
          costStatus: "reported", accountingReceiptReady: true, accountingReceiptId: receipt.id,
          accountingReceiptSourceId: receipt.sourceId, accountingReceiptSequence: receipt.sequence } }] }] };
}
