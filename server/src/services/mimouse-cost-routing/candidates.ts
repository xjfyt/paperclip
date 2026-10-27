import { runtimeRoutingClock } from "./clock.js";
import { and, eq } from "drizzle-orm";
import { mimousePromptApplications as applications, mimousePromptApplicationHeads as heads } from "@paperclipai/db/schema/mimouse_prompt_applications";
import type { RuntimeRoutingCandidateInput, RuntimeRoutingCandidateSnapshot, RuntimeRoutingPolicy } from "@paperclipai/shared/runtime-cost-routing";
import { conflict, unprocessable } from "../../errors.js";
import { applicationDigest, assertApplicationTarget, resolvePromptApplicationTarget } from "../mimouse-prompt-applications/target.js";
import type { PrivatePromptIdentity, PrivatePromptTx } from "../mimouse-private-prompt-tests/service.js";
import { promptApplicationsEnabled } from "../mimouse-prompt-applications/service.js";
import { buildRuntimeRoutingCandidate } from "./evidence-service.js";
export const runtimeCostRoutingEnabled = () => process.env.PAPERCLIP_RUNTIME_COST_ROUTING_ENABLED === "true";
export function requireRuntimeCostRoutingEnabled() {
  if (!runtimeCostRoutingEnabled() || !promptApplicationsEnabled()) throw unprocessable("runtime_routing_disabled");
}
export async function snapshotRuntimeRoutingCandidate(tx: PrivatePromptTx, actor: PrivatePromptIdentity,
  candidate: RuntimeRoutingCandidateInput, policy: RuntimeRoutingPolicy): Promise<RuntimeRoutingCandidateSnapshot> {
  const target = await resolvePromptApplicationTarget(tx, actor.companyId, candidate.agentId, actor.userId);
  const [head] = await tx.select().from(heads).where(and(eq(heads.companyId, actor.companyId), eq(heads.agentId, candidate.agentId))).for("share");
  const [application] = await tx.select().from(applications).where(and(eq(applications.companyId, actor.companyId), eq(applications.id, candidate.applicationId))).for("share");
  if (!head?.configuredAt || head.applicationId !== candidate.applicationId || head.generation !== candidate.applicationGeneration ||
    !application || application.agentId !== candidate.agentId || application.promptId !== candidate.promptId || application.actorUserId !== actor.userId ||
    applicationDigest(application.comparison) !== applicationDigest(candidate.comparison)) throw conflict("runtime_routing_application_binding_changed");
  assertApplicationTarget(application.snapshot, target);
  const evidence = await buildRuntimeRoutingCandidate(tx, actor, candidate, { datasetId: policy.datasetId,
    datasetHash: policy.datasetHash, maxEvidenceAgeHours: policy.maxEvidenceAgeHours, now: await runtimeRoutingClock(tx) });
  if (evidence.revisionId !== application.revisionId || evidence.revisionHash !== application.revisionHash ||
    evidence.reportHash !== application.reportHash || evidence.model !== target.model) throw conflict("runtime_routing_evidence_application_mismatch");
  return { candidate, evidence, target };
}
export async function snapshotRuntimeRoutingPool(tx: PrivatePromptTx, actor: PrivatePromptIdentity, policy: RuntimeRoutingPolicy) {
  const result: RuntimeRoutingCandidateSnapshot[] = [];
  // All agents/heads are locked in stable order across prepare/approve/task/dispatch.
  for (const candidate of [...policy.candidates].sort((a, b) => a.agentId < b.agentId ? -1 : 1)) {
    result.push(await snapshotRuntimeRoutingCandidate(tx, actor, candidate, policy));
  }
  const scope = (item: RuntimeRoutingCandidateSnapshot) => ({ promptId: item.evidence.promptId, revisionId: item.evidence.revisionId,
    revisionHash: item.evidence.revisionHash, datasetId: item.evidence.datasetId, datasetHash: item.evidence.datasetHash,
    skillVersionId: item.evidence.skillVersionId, skillVersionHash: item.evidence.skillVersionHash,
    cases: item.evidence.cases.map(row => row.caseId).sort() });
  if (result.some(item => applicationDigest(scope(item)) !== applicationDigest(scope(result[0]!)))) throw conflict("runtime_routing_pool_context_mismatch");
  const now = await runtimeRoutingClock(tx);
  if (result.some(item => now.getTime() - Date.parse(item.evidence.oldestFinishedAt) > policy.maxEvidenceAgeHours * 3_600_000)) throw conflict("runtime_routing_evidence_expired_during_validation");
  return result;
}
export function assertRuntimeRoutingSnapshots(expected: RuntimeRoutingCandidateSnapshot[], actual: RuntimeRoutingCandidateSnapshot[]) {
  if (applicationDigest(expected) !== applicationDigest(actual)) throw conflict("runtime_routing_candidate_evidence_or_target_changed");
}
