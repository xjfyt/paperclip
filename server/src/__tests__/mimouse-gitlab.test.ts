import { describe, expect, it, vi } from "vitest";
import { deliveryGate, gitlabClient, gitlabOrigin, repairDecision, mergeRequestReceipt, pipelineReceipt } from "../services/mimouse-coding/gitlab.js";
const sha = "a".repeat(40), other = "b".repeat(40);
const valid = { headSha: sha, reviewedSha: sha, mr: { iid: 1, sha, state: "opened" }, pipeline: { id: 2, sha, status: "success" }, evidence: [{ commitSha: sha, command: "npm test", exitCode: 0, startedAt: "2026-10-25T00:00:00Z", finishedAt: "2026-10-25T00:01:00Z", logRef: "fixture/log", status: "passed" as const }] };
describe("GitLab fixed-commit evidence", () => {
  it("requires all evidence on the exact reviewed head", () => { expect(deliveryGate(valid).readyForReleaseCandidate).toBe(true); expect(deliveryGate(valid).productionReleaseAuthorized).toBe(false); });
  it("rejects a previously successful pipeline after a new commit", () => { expect(deliveryGate({ ...valid, pipeline: { id: 2, sha: other, status: "success" } }).blockers).toContain("ci_not_verified_for_head"); });
  it("invalidates previous review when head changes", () => { expect(deliveryGate({ ...valid, headSha: other }).blockers).toContain("review_stale_or_missing"); });
  it("never treats missing or blocked checks as success", () => { expect(deliveryGate({ ...valid, evidence: [] }).readyForReleaseCandidate).toBe(false); expect(deliveryGate({ ...valid, evidence: [{ ...valid.evidence[0], status: "blocked" }] }).readyForReleaseCandidate).toBe(false); });
  it("bounds repair loops, repeated failures and unavailable environments", () => {
    const input = { attempts: 0, remainingBudgetCents: 10, elapsedMs: 100, maxDurationMs: 1000, fingerprint: "one", previousFingerprint: null, environmentAvailable: true };
    expect(repairDecision(input).action).toBe("repair");
    expect(repairDecision({ ...input, attempts: 2 }).action).toBe("human"); expect(repairDecision({ ...input, previousFingerprint: "one" }).action).toBe("human"); expect(repairDecision({ ...input, environmentAvailable: false }).action).toBe("human");
  });
  it("does not send credentials to an unapproved GitLab", () => { expect(() => gitlabOrigin("https://evil.example", ["https://git.example"])).toThrow(); });
  it("uses CE-compatible MR endpoints and preserves uncertain mutations", async () => {
    const transport = vi.fn().mockRejectedValue(Error("network")); const client = gitlabClient({ origin: "https://git.example", projectId: 1, token: "fixture", allowedOrigins: ["https://git.example"] }, transport);
    await expect(client.createMergeRequest("work", "main", "Title")).rejects.toMatchObject({ uncertain: true }); expect(transport).toHaveBeenCalledTimes(1);
  });
  it("reports unknown capabilities when version cannot be read", async () => {
    const client = gitlabClient({ origin: "https://git.example", projectId: 1, token: "fixture", allowedOrigins: ["https://git.example"] }, vi.fn().mockResolvedValue(new Response(null, { status: 403 })));
    expect((await client.capabilities()).version).toBeNull(); expect((await client.capabilities()).advancedApprovals).toBe("unknown");
  });
});

describe("GitLab receipt minimization", () => {
  it("does not persist raw users, descriptions, tokens or external links", () => {
    const input = { iid: 1, sha, state: "opened", description: "private", author: { token: "secret" }, web_url: "https://evil.example/?token=secret" };
    expect(mergeRequestReceipt(input, "https://git.example")).toEqual({ iid: 1, sha, state: "opened", web_url: undefined });
    expect(pipelineReceipt({ id: 2, sha, status: "success", variables: [{ secret: true }], web_url: "https://git.example/pipelines/2" }, "https://git.example")).toEqual({ id: 2, sha, status: "success", web_url: "https://git.example/pipelines/2" });
  });
  it("rejects malformed identity and preserves uncertain create results", async () => {
    expect(() => mergeRequestReceipt({ iid: -1, sha, state: "opened" }, "https://git.example")).toThrow();
    const client = gitlabClient({ origin: "https://git.example", projectId: 1, token: "fixture", allowedOrigins: ["https://git.example"] }, vi.fn().mockResolvedValue(Response.json({ iid: 1 })));
    await expect(client.createMergeRequest("work", "main", "Title")).rejects.toMatchObject({ uncertain: true });
  });
});

it("carries one overall abort deadline through every read-only pagination request", async () => {
  const controller = new AbortController(); const signals: AbortSignal[] = [];
  const transport = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const signal = init!.signal as AbortSignal; signals.push(signal);
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    controller.abort();
    return Response.json([{ id: 1, sha, status: "success" }], { headers: { "x-next-page": "2" } });
  });
  const client = gitlabClient({ origin: "https://git.example", projectId: 1, token: "fixture", allowedOrigins: ["https://git.example"], signal: controller.signal }, transport);
  await expect(client.pipelines(sha)).rejects.toMatchObject({ code: "gitlab_transport_unconfirmed" });
  expect(transport).toHaveBeenCalledTimes(2); expect(signals.every(signal => signal.aborted)).toBe(true);
});

it.each([{ attempts: -1 }, { attempts: NaN }, { remainingBudgetCents: NaN }, { remainingBudgetCents: Infinity }, { elapsedMs: -1 }, { maxDurationMs: Infinity }, { fingerprint: "" }])("fails closed on invalid repair limit %j", invalid => {
  expect(repairDecision({ attempts: 0, remainingBudgetCents: 10, elapsedMs: 100, maxDurationMs: 1000, fingerprint: "one", previousFingerprint: null, environmentAvailable: true, ...invalid })).toEqual({ action: "human", reason: "invalid_repair_limits" });
});
