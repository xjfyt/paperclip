// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { applicationJournalKey, readApplicationJournal, startApplicationJournal, clearApplicationJournal, type PromptApplicationJournal } from "./prompt-application-journal";
import { applicationId as id, applicationEvidence as evidence } from "@/test/prompt-application-fixtures";
const entry = (): PromptApplicationJournal => ({ version: 1, companyId: id(1), userId: "user", originSessionId: "session", promptId: id(7), requestId: id(21), agentId: id(9), action: "prepare", expectedGeneration: 0, applicationId: null, approvalDigest: null, proposal: { comparison: evidence.comparison, approvalValidForMinutes: 60 } });
beforeEach(() => { vi.restoreAllMocks(); sessionStorage.clear(); });
it("persists only allowlisted request metadata and isolates company/user without discarding prior session recovery", () => {
  const value = startApplicationJournal(entry()); expect(readApplicationJournal(id(1), "user")).toEqual(value); expect(readApplicationJournal(id(2), "user")).toBeNull(); expect(readApplicationJournal(id(1), "other")).toBeNull();
  expect(JSON.parse(sessionStorage.getItem(applicationJournalKey(id(1), "user"))!)).toEqual(entry());
  expect(value.originSessionId).toBe("session");
});
it.each(["prompt", "output", "comparison", "secret", "checks", "authorization"])("rejects unexpected %s before saving", key => {
  expect(() => startApplicationJournal({ ...entry(), [key]: "PRIVATE" })).toThrow(); expect(sessionStorage.length).toBe(0);
});
it("never replaces an unresolved operation and requires an exact CAS for clearing", () => {
  const value = startApplicationJournal(entry()); expect(() => startApplicationJournal({ ...entry(), requestId: id(22) })).toThrow();
  expect(() => clearApplicationJournal({ ...value, expectedGeneration: 1 })).toThrow(); expect(readApplicationJournal(id(1), "user")).toEqual(value);
  clearApplicationJournal(value); expect(readApplicationJournal(id(1), "user")).toBeNull();
});
it("fails closed when storage cannot confirm a write or contains another identity", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {}); expect(() => startApplicationJournal(entry())).toThrow(); vi.restoreAllMocks();
  sessionStorage.setItem(applicationJournalKey(id(1), "user"), JSON.stringify({ ...entry(), userId: "other" })); expect(() => readApplicationJournal(id(1), "user")).toThrow();
});
it("requires a known application and digest for approve/rollback recovery", () => {
  for (const action of ["approve", "rollback"] as const) expect(() => startApplicationJournal({ ...entry(), action })).toThrow();
  const value = startApplicationJournal({ ...entry(), action: "approve", applicationId: id(20), approvalDigest: "f".repeat(64), proposal: null }); expect(readApplicationJournal(id(1), "user")).toEqual(value);
});
