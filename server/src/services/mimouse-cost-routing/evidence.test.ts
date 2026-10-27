import { expect, it } from "vitest";
import { qualifyRuntimeRoutingCandidate, type RuntimeRoutingEvidenceSource } from "./evidence.js";
import { routingEvidenceFixture, evidenceNow } from "./evidence-fixture.js";
import { receiptFingerprint } from "../receipt-fingerprint.js";
const constraints = (e: RuntimeRoutingEvidenceSource) => ({ datasetId: e.comparison.dataset.id, datasetHash: e.comparison.dataset.datasetHash, maxEvidenceAgeHours: 24, now: evidenceNow });
const qualify = (e: RuntimeRoutingEvidenceSource) => qualifyRuntimeRoutingCandidate(e, constraints(e));
it("qualifies only own-agent exact-case proxy with fully correlated CLI USD provenance", async () => {
  const e = await routingEvidenceFixture(), actual = await qualify(e);
  expect(actual).toMatchObject({ schemaVersion: 2, agentId: e.candidate.agentId, actorUserId: e.comparison.actor.userId,
    observedCostCents: "0.1250000", passedCases: 1, totalCases: 1, scorer: "exact_text_v1", costBasis: "settled_per_run_cli_reported_usd",
    qualityBasis: "bare_text_proxy_v1", ordinaryToolsQualityProven: false, completeContextCaptured: false, futureCostQuoted: false });
  expect(actual.cases[0]).toMatchObject({ testId: e.comparison.tests[1].id, receiptId: e.accounting[0].receipts[0].id });
  expect(JSON.stringify(actual)).not.toMatch(/SENTINEL|WRONG_TRIMMED|fixed-fixture|secretId|secretValueHash|modelUsage|resultJson/);
  expect(await qualify(e)).toEqual(actual);
});
const mutations: Record<string, (e: RuntimeRoutingEvidenceSource) => void> = {
  foreign_author: e => { e.comparison.actor.userId = "other"; },
  foreign_company: e => { e.comparison.actor.companyId = e.comparison.dataset.id; },
  candidate_other_agent: e => { e.candidate.agentId = e.comparison.dataset.id; },
  wrong_prompt: e => { e.candidate.promptId = e.comparison.dataset.id; },
  dataset_tamper: e => { e.comparison.dataset.cases[0].expected = "forged"; },
  missing_case: e => { e.accounting = []; },
  duplicate_case: e => { e.accounting.push(e.accounting[0]); },
  context_changed: e => { e.accounting[0].executionContextHash = "0".repeat(64); },
  profile_changed: e => { e.currentProfileHash = "0".repeat(64); },
  prepared_prompt_changed: e => { e.comparison.tests[1].prepared!.promptHash = "0".repeat(64); },
  unspawned: e => { e.comparison.tests[1].spawnedAt = null; },
  failed_run: e => { e.comparison.runs[1].status = "failed"; },
  retry_run: e => { e.comparison.runs[1].retryOfRunId = e.comparison.runs[0].id; },
  wrong_output: e => { e.comparison.tests[1].privateResult!.resultJson!.result = "self-declared success"; },
  no_cost: e => { e.accounting[0].costs = []; },
  duplicated_cost: e => { e.accounting[0].costs.push(e.accounting[0].costs[0]); },
  unattributed_extra_cost: e => { e.accounting[0].costs.push({ ...e.accounting[0].costs[0], issueId: null }); },
  subscription: e => { e.accounting[0].costs[0].billingType = "subscription_included"; },
  estimated: e => { e.accounting[0].costs[0].costStatus = "estimated"; },
  credit: e => { e.accounting[0].costs[0].billingType = "credits"; },
  corrected_ledger: e => { e.accounting[0].costs[0].reportedCostCents = "0.1"; },
  manual_ledger: e => { e.accounting[0].costs[0].idempotencyKey = "manual"; },
  unaccounted: e => { e.accounting[0].heartbeats[0].costAccountedAt = null; },
  pending: e => { e.accounting[0].heartbeats[0].costAccountingPending = true; },
  accounting_v1: e => { e.accounting[0].heartbeats[0].accountingProjectionVersion = "v1"; },
  extra_heartbeat: e => { e.accounting[0].heartbeats.push(e.accounting[0].heartbeats[0]); },
  no_receipt: e => { e.accounting[0].receipts = []; },
  duplicate_receipt: e => { e.accounting[0].receipts.push(e.accounting[0].receipts[0]); },
  partial_receipt: e => { e.accounting[0].receipts[0].complete = false; },
  forged_receipt_hash: e => { e.accounting[0].receipts[0].receiptHash = "0".repeat(64); },
  replaced_source: e => { e.accounting[0].receipts[0].sourceId = e.comparison.dataset.id; },
  wrong_wake: e => { e.wakes[0].runId = e.comparison.dataset.id; },
  unconfirmed_wake: e => { e.wakes[0].status = "claimed"; },
  changed_wake_author: e => { e.wakes[0].requestedByActorId = "other"; },
  future: e => { e.accounting[0].heartbeats[0].costAccountedAt = new Date(evidenceNow.getTime() + 1); },
  time_reversed: e => { e.comparison.tests[1].spawnedAt = evidenceNow; },
  stale: e => { e.accounting[0].heartbeats[0].finishedAt = new Date(evidenceNow.getTime() - 25 * 3600000); },
  configured_only: e => { delete e.comparison.tests[1].privateResult!.resultJson!.modelUsage; },
  mixed_model: e => { Object.assign(e.comparison.tests[1].privateResult!.resultJson!.modelUsage!, { "claude-other": {} }); },
  no_cli_cost: e => { delete e.comparison.tests[1].privateResult!.resultJson!.total_cost_usd; },
  wrong_cli_cost: e => { e.comparison.tests[1].privateResult!.resultJson!.total_cost_usd = 0; },
  wrong_tokens: e => { e.accounting[0].costs[0].inputTokens++; },
};
it.each(Object.entries(mutations))("fails closed on %s, without an acknowledgement override", async (_name, mutate) => {
  const e = await routingEvidenceFixture(); mutate(e); await expect(qualify(e)).rejects.toThrow();
});
it.each(["unknown", "subscription", "currency", "mixed", "non_per_run", "missing_usage", "missing_cost", "invoice", "legacy_version", "wrong_amount"])("rejects %s even with a valid journal fingerprint", async kind => {
  const e = await routingEvidenceFixture(), receipt = e.accounting[0].receipts[0], envelope = receipt.receiptJson as Record<string, any>, p = envelope.receipt;
  if (kind === "unknown") p.model = "unknown";
  if (kind === "subscription") p.billingType = "subscription";
  if (kind === "currency") p.currency = "CNY";
  if (kind === "mixed") p.usageByModel = [{ model: p.model, usage: p.usage, costUsd: p.costUsd }];
  if (kind === "non_per_run") p.usageBasis = "session_cumulative";
  if (kind === "missing_usage") delete p.usage;
  if (kind === "missing_cost") delete p.costUsd;
  if (kind === "invoice") p.pricingProvenance.source = "provider_invoice";
  if (kind === "legacy_version") p.pricingProvenance.version = "accounting-receipt/v1";
  if (kind === "wrong_amount") p.costUsd = 0;
  receipt.receiptHash = receiptFingerprint(envelope);
  await expect(qualify(e)).rejects.toThrow();
});
it("does not accept the old comparison ledger subtotal as accounting proof", async () => {
  const e = await routingEvidenceFixture(); e.comparison.costs.set(e.comparison.tests[1].id, 0);
  // Changing a comparison's diagnostics cannot lower the independently proved cost.
  expect((await qualify(e)).observedCostCents).toBe("0.1250000");
});
