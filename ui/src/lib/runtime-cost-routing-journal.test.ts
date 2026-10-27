// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { startRoutingJournal, readRoutingJournal, clearRoutingJournal, routingJournalKey, rememberRoutingBinding, readRoutingBindingReference } from "./runtime-cost-routing-journal";
import { routingId as id, routingPolicy } from "@/test/runtime-cost-routing-fixtures";
const scope = { companyId: id(1), userId: "owner", sessionId: "session", authEpoch: 1 };
const value = () => ({ version: 2 as const, ...scope, action: "prepare" as const, requestId: id(4), payload: { requestId: id(4), expectedGeneration: 0, policy: routingPolicy(), approvalValidForMinutes: 60 } });
beforeEach(() => { sessionStorage.clear(); vi.restoreAllMocks(); });
it("persists strict metadata only and requires exact matching closure", () => {
  const saved = startRoutingJournal(value()); expect(readRoutingJournal(scope)).toEqual(saved);
  expect(() => clearRoutingJournal({ ...saved, requestId: id(5) })).toThrow(); expect(readRoutingJournal(scope)).toEqual(saved); clearRoutingJournal(saved); expect(readRoutingJournal(scope)).toBeNull();
});
it.each(["rawInput", "rawOutput", "secret", "confirmExecution"])("rejects unallowlisted %s before writing", key => {
  expect(() => startRoutingJournal({ ...value(), [key]: "PRIVATE" } as any)).toThrow(); expect(sessionStorage.length).toBe(0);
});
it("does not accept corrupted company or actor bindings", () => {
  sessionStorage.setItem(routingJournalKey(scope), JSON.stringify({ ...value(), userId: "other" })); expect(() => readRoutingJournal(scope)).toThrow();
});
it("storage failure blocks mutation metadata before any request", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {}); expect(() => startRoutingJournal(value())).toThrow();
});
it("last-binding pointer contains only scoped identity metadata and never grants execution", () => {
  rememberRoutingBinding(scope, id(200)); expect(readRoutingBindingReference(scope)).toBe(id(200)); expect(readRoutingBindingReference({ ...scope, userId: "other" })).toBeNull();
  expect(readRoutingBindingReference({ ...scope, sessionId: "other" })).toBeNull(); expect(sessionStorage.getItem(`${routingJournalKey(scope)}:binding`)).not.toMatch(/title|description|confirm|runId|model/);
});
it("a new session cannot overwrite an earlier unresolved request from the same actor", () => {
  startRoutingJournal(value()); expect(readRoutingJournal({ ...scope, sessionId: "new" })).toBeNull();
  expect(() => startRoutingJournal({ ...value(), sessionId: "new" })).toThrow(); expect(readRoutingJournal(scope)).not.toBeNull();
});
