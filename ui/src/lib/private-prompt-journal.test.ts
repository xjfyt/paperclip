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
