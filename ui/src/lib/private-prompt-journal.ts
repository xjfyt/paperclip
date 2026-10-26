import { privatePromptRecordSchema, privateObject, privateString, privateUuid, privateHash, type VerifiedPrivatePromptRecord } from "@/api/private-prompt-tests";
export type PrivatePromptJournal = {
  version: 1; companyId: string; userId: string; originSessionId: string; operationId: string;
  promptId: string; requestId: string; revisionId: string; headReceiptId: string | null;
  agentId: string; datasetId: string; caseId: string; skillVersionId: string; executionProfile: "claude_cli_bare_api_key_v1";
  phase: "prepare_pending" | "awaiting_confirmation" | "execute_pending" | "cancel_pending" | "accepted";
  testId: string | null; approvalDigest: string | null;
};
function parseJournal(raw: unknown): PrivatePromptJournal {
  const r = privateObject(raw), phase = privateString(r.phase);
  const keys = ["version", "companyId", "userId", "originSessionId", "operationId", "promptId", "requestId", "revisionId", "headReceiptId", "agentId", "datasetId", "caseId", "skillVersionId", "executionProfile", "phase", "testId", "approvalDigest"];
  if (Object.keys(r).length !== keys.length || Object.keys(r).some(key => !keys.includes(key)) || r.version !== 1 || r.executionProfile !== "claude_cli_bare_api_key_v1" || !["prepare_pending", "awaiting_confirmation", "execute_pending", "cancel_pending", "accepted"].includes(phase)) throw Error("private_journal_invalid");
  const value: PrivatePromptJournal = { version: 1, companyId: privateUuid(r.companyId), userId: privateString(r.userId), originSessionId: privateString(r.originSessionId), operationId: privateUuid(r.operationId),
    promptId: privateUuid(r.promptId), requestId: privateUuid(r.requestId), revisionId: privateUuid(r.revisionId), headReceiptId: r.headReceiptId === null ? null : privateUuid(r.headReceiptId),
    agentId: privateUuid(r.agentId), datasetId: privateUuid(r.datasetId), caseId: privateUuid(r.caseId), skillVersionId: privateUuid(r.skillVersionId), executionProfile: "claude_cli_bare_api_key_v1",
    phase: phase as PrivatePromptJournal["phase"], testId: r.testId === null ? null : privateUuid(r.testId), approvalDigest: r.approvalDigest === null ? null : privateHash(r.approvalDigest) };
  if (phase === "prepare_pending" ? value.testId !== null || value.approvalDigest !== null : !value.testId || !value.approvalDigest) throw Error("private_journal_invalid");
  return value;
}
export function privatePromptJournalKey(companyId: string, userId: string) { return `paperclip.private-prompt.pending.v1:${JSON.stringify([companyId, userId])}`; }
/** Only allowlisted non-secret identifiers. Never persist results, prompt or credentials. */
export function readPrivatePromptJournal(companyId: string, userId: string): PrivatePromptJournal | null {
  const raw = sessionStorage.getItem(privatePromptJournalKey(companyId, userId));
  if (raw === null) return null;
  const value = parseJournal(JSON.parse(raw));
  if (value.companyId !== companyId || value.userId !== userId) throw Error("private_journal_scope_invalid");
  return value;
}
export function replacePrivatePromptJournal(next: PrivatePromptJournal, expectedOperationId: string | null) {
  const value = parseJournal(next), current = readPrivatePromptJournal(value.companyId, value.userId);
  if ((current?.operationId ?? null) !== expectedOperationId) throw Error("private_journal_changed");
  const raw = JSON.stringify(value); sessionStorage.setItem(privatePromptJournalKey(value.companyId, value.userId), raw);
  if (sessionStorage.getItem(privatePromptJournalKey(value.companyId, value.userId)) !== raw) throw Error("private_journal_write_unconfirmed");
  return value;
}
export function clearPrivatePromptJournal(expected: PrivatePromptJournal) {
  const current = readPrivatePromptJournal(expected.companyId, expected.userId);
  if (!current || current.operationId !== expected.operationId) throw Error("private_journal_changed");
  sessionStorage.removeItem(privatePromptJournalKey(expected.companyId, expected.userId));
  if (sessionStorage.getItem(privatePromptJournalKey(expected.companyId, expected.userId)) !== null) throw Error("private_journal_clear_unconfirmed");
}
export function verifyPrivatePromptBinding(raw: unknown, pending: PrivatePromptJournal): VerifiedPrivatePromptRecord {
  const row = privatePromptRecordSchema.parse(raw);
  pending = parseJournal(pending);
  // UUID spelling is not identity. Never rewrite persisted requests or opaque actor/hash values.
  const sameUuid = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();
  const sameHead = row.headReceiptId === null || pending.headReceiptId === null
    ? row.headReceiptId === pending.headReceiptId : sameUuid(row.headReceiptId, pending.headReceiptId);
  const same = sameUuid(row.companyId, pending.companyId) && row.actorUserId === pending.userId && sameUuid(row.promptId, pending.promptId) &&
    sameUuid(row.requestId, pending.requestId) && sameUuid(row.revisionId, pending.revisionId) && sameHead &&
    sameUuid(row.agentId, pending.agentId) && sameUuid(row.datasetId, pending.datasetId) && sameUuid(row.caseId, pending.caseId) && sameUuid(row.skillVersionId, pending.skillVersionId) &&
    row.executionProfile === pending.executionProfile && (pending.testId === null || sameUuid(row.id, pending.testId)) &&
    (pending.approvalDigest === null || row.approvalDigest === pending.approvalDigest);
  if (!same) throw Error("private_result_binding_invalid");
  return row;
}
