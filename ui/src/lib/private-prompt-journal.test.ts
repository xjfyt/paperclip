// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { ids, marker, record } from "@/test/private-prompt-fixtures";
import { clearPrivatePromptJournal, privatePromptJournalKey, readPrivatePromptJournal, replacePrivatePromptJournal, verifyPrivatePromptBinding } from "./private-prompt-journal";
afterEach(() => sessionStorage.clear());
it("persists only strict non-secret metadata and isolates company/user scopes", () => {
  const value = marker(); replacePrivatePromptJournal(value, null);
  expect(readPrivatePromptJournal(ids.company, "user")).toEqual(value);
  expect(readPrivatePromptJournal(ids.company, "other")).toBeNull();
  expect(() => replacePrivatePromptJournal({ ...value, content: "secret" } as never, value.operationId)).toThrow();
  expect(sessionStorage.getItem(privatePromptJournalKey(ids.company, "user"))).not.toContain("secret");
});
it("an old response cannot clear a newer operation marker", () => {
  const first = marker(); replacePrivatePromptJournal(first, null);
  const next = marker({ operationId: ids.ref }); replacePrivatePromptJournal(next, first.operationId);
  expect(() => clearPrivatePromptJournal(first)).toThrow();
  expect(readPrivatePromptJournal(ids.company, "user")).toEqual(next);
});
it.each(["companyId", "actorUserId", "requestId", "id", "approvalDigest", "agentId", "datasetId", "caseId", "skillVersionId", "revisionId", "promptId", "headReceiptId", "executionProfile"])("rejects mismatched %s before acknowledgment", field => {
  const value: Record<string, unknown> = { ...record() };
  value[field] = field === "approvalDigest" ? "b".repeat(64) : field === "actorUserId" ? "other" : ids.operation;
  expect(() => verifyPrivatePromptBinding(value, marker())).toThrow();
});
it("rejects malformed storage rather than erasing an unresolved marker", () => {
  const key = privatePromptJournalKey(ids.company, "user"); sessionStorage.setItem(key, "not json");
  expect(() => readPrivatePromptJournal(ids.company, "user")).toThrow(); expect(sessionStorage.getItem(key)).toBe("not json");
});

const letterUuid = "abcdefab-cdef-4abc-abcd-abcdefabcdef";
it.each(["companyId", "promptId", "requestId", "revisionId", "agentId", "datasetId", "caseId", "skillVersionId", "headReceiptId"] as const)("binds validated %s UUIDs regardless of spelling without rewriting metadata", field => {
  const pending = marker({ [field]: letterUuid.toUpperCase() });
  const original = structuredClone(pending);
  expect(verifyPrivatePromptBinding(record({ [field]: letterUuid }), pending)[field]).toBe(letterUuid);
  expect(pending).toEqual(original);
  expect(() => verifyPrivatePromptBinding(record({ [field]: ids.operation }), pending)).toThrow();
});
it("binds the test UUID semantically but keeps null head distinct from UUID heads", () => {
  expect(verifyPrivatePromptBinding(record({ id: letterUuid }), marker({ testId: letterUuid.toUpperCase() })).id).toBe(letterUuid);
  expect(() => verifyPrivatePromptBinding(record({ headReceiptId: letterUuid }), marker())).toThrow();
  expect(() => verifyPrivatePromptBinding(record(), marker({ headReceiptId: letterUuid }))).toThrow();
  expect(() => verifyPrivatePromptBinding(record({ id: ids.operation }), marker({ testId: letterUuid }))).toThrow();
});
it("preserves opaque identity, hash and operation CAS case sensitivity", () => {
  const pending = marker({ operationId: letterUuid.toUpperCase(), originSessionId: "Session-ABC", userId: "User-ABC" });
  replacePrivatePromptJournal(pending, null);
  expect(readPrivatePromptJournal(ids.company, "User-ABC")).toEqual(pending);
  expect(readPrivatePromptJournal(ids.company, "user-abc")).toBeNull();
  expect(() => verifyPrivatePromptBinding(record({ actorUserId: "user-abc" }), pending)).toThrow();
  expect(() => verifyPrivatePromptBinding(record({ approvalDigest: "A".repeat(64), actorUserId: "User-ABC" }), pending)).toThrow();
  expect(() => replacePrivatePromptJournal(pending, letterUuid)).toThrow("private_journal_changed");
  expect(() => clearPrivatePromptJournal({ ...pending, operationId: letterUuid })).toThrow("private_journal_changed");
  expect(readPrivatePromptJournal(ids.company, "User-ABC")).toEqual(pending);
});
it("rejects malformed records and journals before semantic UUID binding", () => {
  expect(() => verifyPrivatePromptBinding(record({ agentId: "not-a-uuid" }), marker({ agentId: "NOT-A-UUID" }))).toThrow();
  expect(() => verifyPrivatePromptBinding(record(), { ...marker(), extra: true } as never)).toThrow();
});
