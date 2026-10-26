// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiError } from "@/api/client";
import { i18n } from "@/i18n";
import en from "@/i18n/contributions/privatePromptComparisonUi/en.json";
import zh from "@/i18n/contributions/privatePromptComparisonUi/zh-CN.json";
import es from "@/i18n/contributions/privatePromptComparisonUi/es.json";
import ja from "@/i18n/contributions/privatePromptComparisonUi/ja.json";
import { comparisonId as id, comparisonInput as input, comparisonReport as report } from "@/test/private-prompt-comparison-fixtures";
import { privateComparisonBlockerLabels, privateComparisonBlockerLabel } from "@/lib/private-prompt-comparison-blockers";
import { PrivatePromptComparison } from "./PrivatePromptComparison";
const compare = vi.hoisted(() => vi.fn());
vi.mock("@/api/private-prompt-comparison", async original => ({ ...await original<typeof import("@/api/private-prompt-comparison")>(), privatePromptComparisonApi: () => ({ compare }) }));
let host: HTMLDivElement, root: Root;
const denied = vi.fn(), label = (key: string) => i18n.t(`privatePromptComparisonUi.${key}`);
const button = (key: string) => [...host.querySelectorAll("button")].find(item => item.textContent === label(key))!;
const props = { companyId: id(1), userId: "user", sessionId: "session", promptId: id(7), onAccessLost: denied };
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); }
async function mount(patch = {}) { await act(async () => root.render(<PrivatePromptComparison {...props} {...patch} />)); await flush(); }
async function click(key: string) { await act(async () => button(key).click()); await flush(); }
async function fill(key: string, value: string) {
  const element = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${label(key)}"]`)!;
  await act(async () => { Object.getOwnPropertyDescriptor(element.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(element, value); element.dispatchEvent(new Event("input", { bubbles: true })); });
}
async function ready() { for (const key of ["datasetId", "baselineRevisionId", "candidateRevisionId"] as const) await fill(key, input[key]); await fill("testIds", input.testIds.join("\n")); }
beforeEach(async () => {
  for (const [locale, value] of Object.entries({ en, "zh-CN": zh, es, ja })) i18n.addResourceBundle(locale, "translation", { privatePromptComparisonUi: value }, true, true);
  await i18n.changeLanguage("en"); compare.mockReset().mockResolvedValue(report()); denied.mockClear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });
it("does nothing on mount or editing; explicit read-only button submits IDs only", async () => {
  await mount(); expect(compare).not.toHaveBeenCalled(); await ready(); expect(compare).not.toHaveBeenCalled(); await click("compare");
  expect(compare).toHaveBeenCalledExactlyOnceWith(id(7), input); expect(host.textContent).toContain(label("reviewable")); expect(host.textContent).not.toContain("privatePromptComparisonUi.");
});
it("renders all four languages and boundary labels", async () => {
  for (const value of [zh, es, ja]) expect(Object.keys(value).sort()).toEqual(Object.keys(en).sort()); await mount();
  for (const locale of ["en", "zh-CN", "es", "ja"]) { await act(async () => { await i18n.changeLanguage(locale); }); for (const key of ["boundary", "evidence", "testHelp", "compare"]) expect(host.textContent).toContain(label(key)); }
});
it.each(["companyId", "userId", "sessionId", "promptId"])("%s transition erases drafts and ignores delayed success", async key => {
  let finish!: (value: unknown) => void; compare.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await mount(); await ready(); await click("compare"); await mount({ [key]: id(99) }); await act(async () => finish(report())); await flush();
  expect(host.textContent).not.toContain(label("reviewable")); expect(host.querySelector<HTMLInputElement>("input")?.value).toBe(""); expect(compare).toHaveBeenCalledTimes(1);
});
it("auth verification removes private data and cannot restore a delayed result", async () => {
  let finish!: (value: unknown) => void; compare.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await mount(); await ready(); await click("compare"); await mount({ authPending: true }); expect(host.textContent).toBe("");
  await act(async () => finish(report())); await mount({ authPending: false }); expect(host.textContent).not.toContain(label("reviewable")); expect(button("compare").disabled).toBe(true);
});
it("editing allows a newer comparison; an older response cannot overwrite it", async () => {
  let finish!: (value: unknown) => void; compare.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await mount(); await ready(); await click("compare"); await fill("maxCandidateCostCents", "0"); compare.mockResolvedValueOnce(report({ eligibleForHumanReview: false, blockers: ["candidate_cost_exceeds_limit"] }));
  await click("compare"); expect(host.textContent).toContain(label("blocked")); await act(async () => finish(report())); await flush(); expect(host.textContent).toContain(label("blocked")); expect(host.textContent).not.toContain(label("reviewable"));
});
it.each([401, 403])("HTTP %s clears result and drafts and reports access loss", async status => {
  await mount(); await ready(); await click("compare"); expect(host.textContent).toContain(label("reviewable")); compare.mockRejectedValueOnce(new ApiError("PRIVATE_ERROR_MARKER", status, null)); await click("compare");
  expect(denied).toHaveBeenCalledTimes(1); expect(host.textContent).not.toContain(label("reviewable")); expect(host.textContent).not.toContain("PRIVATE_ERROR_MARKER"); expect(host.querySelector<HTMLInputElement>("input")?.value).toBe("");
});
it("rejects malformed success and clears prior evidence on errors", async () => {
  await mount(); await ready(); await click("compare"); compare.mockResolvedValueOnce({ ...report(), companyId: id(99) }); await click("compare"); expect(host.textContent).not.toContain(label("reviewable")); expect(host.textContent).toContain(label("failed"));
});
it("unknown costs keep quality visible but cannot appear reviewable", async () => {
  const value = report(); compare.mockResolvedValueOnce({ ...value, candidate: { ...value.candidate, totalCostCents: null, unknownCostCases: 1, knownCostCents: 0 }, eligibleForHumanReview: false, blockers: ["candidate_cost_unknown"] });
  await mount(); await ready(); await click("compare"); expect(host.textContent).toContain(label("unknown")); expect(host.textContent).toContain(label("blocked")); expect(host.textContent).toContain("1 / 1"); expect(host.textContent).not.toContain(label("reviewable"));
});
it("clear aborts a pending read and no comparison is written to browser storage", async () => {
  const storage = vi.spyOn(Storage.prototype, "setItem"); let finish!: (value: unknown) => void; compare.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await mount(); await ready(); await click("compare"); await click("clear"); await act(async () => finish(report())); await flush(); expect(host.textContent).not.toContain(label("reviewable")); expect(storage).not.toHaveBeenCalled();
});
it("invalid, duplicate, same-revision and fractional-cap input cannot be submitted", async () => {
  await mount(); await ready(); await fill("testIds", `${id(5)} ${id(5)}`); expect(button("compare").disabled).toBe(true); await ready(); await fill("candidateRevisionId", input.baselineRevisionId); expect(button("compare").disabled).toBe(true);
  await ready(); await fill("maxCandidateCostCents", "0.5"); expect(button("compare").disabled).toBe(true); expect(compare).not.toHaveBeenCalled();
});
it("StrictMode does not execute on mount and supports an explicit comparison", async () => {
  await act(async () => root.render(<StrictMode><PrivatePromptComparison {...props} /></StrictMode>)); await ready(); expect(compare).not.toHaveBeenCalled(); await click("compare"); expect(host.textContent).toContain(label("reviewable"));
});

it("translates every known blocker in four languages without translating unknown codes", () => {
  expect(Object.keys(privateComparisonBlockerLabels)).toHaveLength(13);
  for (const resource of [en, zh, es, ja]) {
    for (const [code, key] of Object.entries(privateComparisonBlockerLabels)) {
      const text = Object.entries(resource).find(([name]) => name === key)?.[1];
      expect(typeof text).toBe("string"); expect(text).not.toBe(code); expect(text?.length).toBeGreaterThan(0);
      expect(privateComparisonBlockerLabel(code)).toBe(key);
    }
  }
  for (const unknown of ["future_code", "toString", id(99), "f".repeat(64)]) expect(privateComparisonBlockerLabel(unknown)).toBeNull();
});
it("shows readable global and case blockers with their original codes; locale switches never refetch", async () => {
  const value = report(); value.candidate.passed = 0; value.candidate.blocked = 1;
  value.results[1] = { ...value.results[1], passed: false, blocked: "run_not_succeeded" };
  value.blockers = ["incomplete_or_mismatched_evidence", "candidate_not_all_passed", "quality_regressed"];
  value.eligibleForHumanReview = false; compare.mockResolvedValueOnce(value);
  await mount(); await ready(); await click("compare");
  for (const locale of ["en", "zh-CN", "es", "ja"]) {
    await act(async () => { await i18n.changeLanguage(locale); });
    for (const code of [...value.blockers, "run_not_succeeded"]) {
      expect(host.textContent).toContain(label(privateComparisonBlockerLabel(code)!));
      expect([...host.querySelectorAll("code")].some(node => node.textContent === `(${code})`)).toBe(true);
    }
    expect(host.textContent).toContain(value.results[1].testId!);
    expect(host.textContent).toContain(value.reportHash);
    expect(host.textContent).not.toContain("privatePromptComparisonUi.");
    expect(compare).toHaveBeenCalledTimes(1);
  }
});
it("hands verified evidence to application review only after an explicit click, and clears it on editing", async () => {
  const review = vi.fn(); await mount({ onReview: review }); await ready(); await click("compare");
  expect(review.mock.calls.some(([value]) => value !== null)).toBe(false);
  await act(async () => [...host.querySelectorAll("button")].find(value => value.textContent === i18n.t("promptApplicationsUi.useEvidence"))!.click());
  expect(review).toHaveBeenLastCalledWith({ comparison: input, report: report() });
  await fill("maxCandidateCostCents", "2"); expect(review).toHaveBeenLastCalledWith(null); expect(compare).toHaveBeenCalledTimes(1);
});
