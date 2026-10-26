import type { PrivateComparisonEvidence } from "./compare.js";
import { privateConfigDigest, privatePromptHash, privatePromptFixedContext, assertPrivatePromptTextInventory, PRIVATE_PROMPT_IMPLEMENTATION } from "./profile.js";
export const comparisonId = (n: number) => `${String(n).padStart(8, "0")}-1111-4111-8111-111111111111`;
/** Inert, synthetic historical rows. No CLI, network, secret or live result. */
export function comparisonFixture(): PrivateComparisonEvidence {
  const id = comparisonId, companyId = id(1), promptId = id(2), actorUserId = "private-comparison-owner";
  const cases = [{ id: id(3), input: "PRIVATE_INPUT_SENTINEL", expected: " exact\r\nanswer " }];
  const version = { id: id(4), companyId, companySkillId: id(5), fileInventory: [{ path: "SKILL.md", kind: "skill", content: "PRIVATE_SKILL_SENTINEL" }] };
  const revisions = [6, 7].map(n => ({ id: id(n), companyId, promptId, content: `PRIVATE_REVISION_SENTINEL_${n}`, contentHash: privatePromptHash(`PRIVATE_REVISION_SENTINEL_${n}`) }));
  const dataset = { id: id(8), companyId, skillId: version.companySkillId, cases, datasetHash: privateConfigDigest(cases) };
  const snapshot = { schemaVersion: 1, executionProfile: "claude_cli_bare_api_key_v1", adapterType: "claude_local", engine: "cli",
    model: "claude-fixture", configuredCwd: "/fixed-fixture", environment: { source: "agent", id: id(9), driver: "local" },
    credential: { kind: "pinned_company_secret", secretId: id(10), version: 1 }, configDigest: privateConfigDigest("historical-config"),
    freshSession: true, toolsEnabled: false, paperclipCredentialsEnabled: false, completeContextCaptured: false };
  const tests = revisions.map((r, i) => {
    const testId = id(20 + i), issueId = id(30 + i), runId = id(40 + i), attemptId = id(50 + i);
    const fixed = privatePromptFixedContext(cases[0].input, version.id, assertPrivatePromptTextInventory(version.fileInventory), r.content);
    const prompt = `${fixed}\n\n<private-prompt-revision>\n${r.content}\n</private-prompt-revision>`;
    return { id: testId, companyId, actorUserId, actorSessionId: "old-session", promptId, revisionId: r.id, revisionHash: r.contentHash,
      agentId: id(11), requestId: id(60 + i), requestDigest: privateConfigDigest("request"), headReceiptId: null,
      datasetId: dataset.id, datasetHash: dataset.datasetHash, caseId: cases[0].id, skillVersionId: version.id, skillVersionHash: privateConfigDigest(version.fileInventory),
      configDigest: snapshot.configDigest, secretValueHash: privatePromptHash("synthetic-not-a-secret"), approvalSnapshot: snapshot,
      status: "completed", issueId, wakeupRequestId: id(70 + i), heartbeatRunId: runId, attemptId,
      prepared: { schemaVersion: 1, testId, attemptId, companyId, issueId, heartbeatRunId: runId, agentId: id(11), revisionId: r.id,
        headReceiptId: null, revisionHash: r.contentHash, promptHash: privatePromptHash(prompt), promptBytes: Buffer.byteLength(prompt),
        runtimeConfigHash: privateConfigDigest("actual-cwd-config"), implementation: PRIVATE_PROMPT_IMPLEMENTATION, providerConsumed: false, stdinWritten: false },
      spawnedAt: new Date(), privateResult: { summary: "WRONG_TRIMMED_SUMMARY", resultJson: { type: "result", subtype: "success", result: cases[0].expected } }, errorCode: null };
  });
  return { actor: { companyId, userId: actorUserId, sessionId: "current-session" }, promptId,
    input: { datasetId: dataset.id, baselineRevisionId: revisions[0].id, candidateRevisionId: revisions[1].id, testIds: tests.map(t => t.id), maxCandidateCostCents: null },
    dataset, revisions, version, tests,
    runs: tests.map(t => ({ id: t.heartbeatRunId, companyId, agentId: t.agentId, issueId: t.issueId, scopeKind: "issue", wakeupRequestId: t.wakeupRequestId, status: "succeeded", runtimeMode: "legacy", retryOfRunId: null })),
    issues: tests.map(t => ({ id: t.issueId, companyId, visibility: "private", assigneeAgentId: t.agentId, responsibleUserId: actorUserId, originKind: "private_prompt_test", originId: t.id, workMode: "skill_test", harnessKind: "skill_test" })),
    costs: new Map(tests.map(t => [t.id, 0.125])),
  } as unknown as PrivateComparisonEvidence;
}
