import { afterEach, expect, it, vi } from "vitest";
import { privatePromptComparisonApi, verifyPrivatePromptComparison } from "./private-prompt-comparison";
import { comparisonId as id, comparisonInput as input, comparisonReport as report } from "@/test/private-prompt-comparison-fixtures";
afterEach(() => { vi.unstubAllGlobals(); });
const verify = (raw: unknown, body = input) => verifyPrivatePromptComparison(raw, id(1), "user", id(7), body);
it("posts only explicit historical IDs with no-store and never coalesces callers", async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify(report()))); vi.stubGlobal("fetch", fetcher);
  await Promise.all([1, 2].map(() => privatePromptComparisonApi(id(1), "user", new AbortController().signal).compare(id(7), input)));
  expect(fetcher).toHaveBeenCalledTimes(2);
  for (const [url, init] of fetcher.mock.calls as unknown as Array<[string, RequestInit]>) {
    expect(url).toBe(`/api/companies/${id(1)}/prompt-registry/${id(7)}/comparison`);
    expect(init).toMatchObject({ method: "POST", cache: "no-store", credentials: "include", signal: expect.any(AbortSignal) });
    expect(JSON.parse(String(init.body))).toEqual(input);
  }
});
it("discards a late success after abort even if fetch ignores the signal", async () => {
  let finish!: (value: Response) => void; vi.stubGlobal("fetch", vi.fn(() => new Promise(resolve => { finish = resolve; })));
  const controller = new AbortController(), pending = privatePromptComparisonApi(id(1), "user", controller.signal).compare(id(7), input);
  controller.abort(); finish(new Response(JSON.stringify(report()))); await expect(pending).rejects.toMatchObject({ name: "AbortError" });
});
it.each(["companyId", "actorUserId", "promptId", "datasetId"])("rejects foreign %s", field => { expect(() => verify({ ...report(), [field]: id(99) })).toThrow(); });
it.each(["baseline", "candidate"])("rejects a foreign %s revision", side => { const value = report(); expect(() => verify({ ...value, [side]: { ...value.baseline, revisionId: id(99) } })).toThrow(); });
it("rejects unrequested, repeated, missing and cross-revision test evidence", () => {
  const value = report();
  for (const results of [[value.results[0]], [...value.results, value.results[0]], value.results.map(row => ({ ...row, testId: id(99) })), value.results.map(row => ({ ...row, revisionId: id(99) }))]) expect(() => verify({ ...value, results })).toThrow();
});
it("rejects empty or inconsistent matrices, summaries and false green evidence", () => {
  const value = report();
  for (const patch of [{ results: [] }, { candidate: { ...value.candidate, passed: 0 } }, { candidate: { ...value.candidate, unknownCostCases: 1 } }, { candidate: { ...value.candidate, totalCostCents: 0 } }, { blockers: ["candidate_cost_unknown"] }, { results: value.results.map(row => ({ ...row, blocked: "run_not_succeeded" })) }]) expect(() => verify({ ...value, ...patch })).toThrow();
  expect(() => verify(value, { ...input, maxCandidateCostCents: 0 })).toThrow();
});
it.each([{ executionStarted: true }, { promoted: true }, { runtimeApplied: true }, { completeContextCaptured: true }, { rawOutput: "private" }, { reportHash: "bad" }])("rejects unsafe or malformed response flags", patch => { expect(() => verify({ ...report(), ...patch })).toThrow(); });
it("rejects duplicate IDs and caller-supplied output before making a request", async () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher); const api = privatePromptComparisonApi(id(1), "user", new AbortController().signal);
  await expect(api.compare(id(7), { ...input, testIds: [id(5), id(5)] })).rejects.toThrow();
  await expect(api.compare(id(7), { ...input, output: "forged" } as never)).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled();
});
it("preserves unknown cost without treating it as zero", () => {
  const value = report(); const parsed = verify({ ...value, candidate: { ...value.candidate, totalCostCents: null, unknownCostCases: 1, knownCostCents: 0 }, eligibleForHumanReview: false, blockers: ["candidate_cost_unknown"] });
  expect(parsed.candidate.totalCostCents).toBeNull(); expect(parsed.candidate.passed).toBe(1);
});

it("binds the budget blocker bidirectionally for absent, higher, equal and exceeded limits", () => {
  const blocked = report({ eligibleForHumanReview: false, blockers: ["candidate_cost_exceeds_limit"] });
  for (const cap of [null, 2, 1]) {
    expect(() => verify(blocked, { ...input, maxCandidateCostCents: cap })).toThrow();
    expect(() => verify(report(), { ...input, maxCandidateCostCents: cap })).not.toThrow();
  }
  expect(() => verify(blocked, { ...input, maxCandidateCostCents: 0 })).not.toThrow();
  const other = report(); other.baseline.totalCostCents = null; other.baseline.unknownCostCases = 1; other.baseline.knownCostCents = 0;
  other.eligibleForHumanReview = false; other.blockers = ["baseline_cost_unknown"];
  expect(() => verify(other, { ...input, maxCandidateCostCents: 0 })).toThrow();
  other.blockers.push("candidate_cost_exceeds_limit");
  expect(() => verify(other, { ...input, maxCandidateCostCents: 0 })).not.toThrow();
  const unknown = report(); unknown.candidate.totalCostCents = null; unknown.candidate.unknownCostCases = 1; unknown.candidate.knownCostCents = 0;
  unknown.eligibleForHumanReview = false; unknown.blockers = ["candidate_cost_unknown"];
  expect(() => verify(unknown, { ...input, maxCandidateCostCents: 0 })).not.toThrow();
  unknown.blockers.push("candidate_cost_exceeds_limit");
  expect(() => verify(unknown, { ...input, maxCandidateCostCents: 0 })).toThrow();
});
it("canonicalizes legal UUID case in request and response bindings without changing opaque actors", async () => {
  const letter = (n: number) => `abcdef1${n}-abcd-4abc-8abc-abcdef123456`;
  const lower = { datasetId: letter(1), baselineRevisionId: letter(2), candidateRevisionId: letter(3), testIds: [letter(4), letter(5)], maxCandidateCostCents: null };
  const upper = { ...lower, datasetId: lower.datasetId.toUpperCase(), baselineRevisionId: lower.baselineRevisionId.toUpperCase(), candidateRevisionId: lower.candidateRevisionId.toUpperCase(), testIds: lower.testIds.map(value => value.toUpperCase()) };
  const value = report({ companyId: letter(6), actorUserId: "OpaqueUser", promptId: letter(7), datasetId: lower.datasetId });
  value.baseline.revisionId = lower.baselineRevisionId; value.candidate.revisionId = lower.candidateRevisionId;
  value.results = value.results.map((row, i) => ({ ...row, revisionId: i ? lower.candidateRevisionId : lower.baselineRevisionId, testId: lower.testIds[i] }));
  expect(verifyPrivatePromptComparison(value, letter(6).toUpperCase(), "OpaqueUser", letter(7).toUpperCase(), upper).datasetId).toBe(lower.datasetId);
  expect(() => verifyPrivatePromptComparison(value, letter(6), "opaqueuser", letter(7), upper)).toThrow();
  const fetcher = vi.fn(async () => new Response(JSON.stringify(value))); vi.stubGlobal("fetch", fetcher);
  await privatePromptComparisonApi(letter(6), "OpaqueUser", new AbortController().signal).compare(letter(7), upper);
  expect(JSON.parse(String((fetcher.mock.calls as unknown as Array<[string, RequestInit]>)[0][1].body))).toEqual(lower);
  await expect(privatePromptComparisonApi(letter(6), "OpaqueUser", new AbortController().signal).compare(letter(7), { ...upper, testIds: [lower.testIds[0], upper.testIds[0]] })).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(1);
});
