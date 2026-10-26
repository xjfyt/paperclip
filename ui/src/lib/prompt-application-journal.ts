import { comparePrivatePromptTestsSchema, type ComparePrivatePromptTests } from "@paperclipai/shared/mimouse-private-prompt-comparison";
import { applicationKeys } from "@/api/prompt-applications";
import { privateHash, privateString, privateUuid } from "@/api/private-prompt-tests";
export type PromptApplicationJournal = {
  version: 1; companyId: string; userId: string; originSessionId: string; promptId: string; requestId: string;
  agentId: string; action: "prepare" | "approve" | "rollback"; expectedGeneration: number;
  applicationId: string | null; approvalDigest: string | null;
  proposal: { comparison: ComparePrivatePromptTests; approvalValidForMinutes: number } | null;
};
function parse(raw: unknown): PromptApplicationJournal {
  const r = applicationKeys(raw, ["version", "companyId", "userId", "originSessionId", "promptId", "requestId", "agentId", "action", "expectedGeneration", "applicationId", "approvalDigest", "proposal"]);
  if (r.version !== 1 || !["prepare", "approve", "rollback"].includes(String(r.action)) || typeof r.expectedGeneration !== "number" || !Number.isSafeInteger(r.expectedGeneration) || r.expectedGeneration < 0) throw Error("prompt_application_journal_invalid");
  const value: PromptApplicationJournal = { version: 1, companyId: privateUuid(r.companyId).toLowerCase(), userId: privateString(r.userId), originSessionId: privateString(r.originSessionId), promptId: privateUuid(r.promptId).toLowerCase(), requestId: privateUuid(r.requestId).toLowerCase(), agentId: privateUuid(r.agentId).toLowerCase(), action: r.action as PromptApplicationJournal["action"], expectedGeneration: r.expectedGeneration, applicationId: r.applicationId === null ? null : privateUuid(r.applicationId).toLowerCase(), approvalDigest: r.approvalDigest === null ? null : privateHash(r.approvalDigest), proposal: null };
  if (r.proposal !== null) {
    const p = applicationKeys(r.proposal, ["comparison", "approvalValidForMinutes"]);
    if (typeof p.approvalValidForMinutes !== "number" || !Number.isInteger(p.approvalValidForMinutes) || p.approvalValidForMinutes < 10 || p.approvalValidForMinutes > 1440) throw Error("prompt_application_journal_invalid");
    value.proposal = { comparison: comparePrivatePromptTestsSchema.parse(p.comparison), approvalValidForMinutes: p.approvalValidForMinutes };
  }
  if (value.action === "prepare" ? value.applicationId !== null || value.approvalDigest !== null || value.proposal === null : !value.applicationId || !value.approvalDigest || value.proposal !== null) throw Error("prompt_application_journal_invalid");
  return value;
}
export function applicationJournalKey(companyId: string, userId: string) { return `paperclip.prompt-application.pending.v1:${JSON.stringify([companyId.toLowerCase(), userId])}`; }
/** Allowlisted metadata only. No prompt, output, credentials or stored confirmation. Comparison contains IDs and a numeric cap only. */
export function readApplicationJournal(companyId: string, userId: string): PromptApplicationJournal | null {
  const raw = sessionStorage.getItem(applicationJournalKey(companyId, userId));
  if (raw === null) return null;
  const value = parse(JSON.parse(raw));
  if (value.companyId !== companyId.toLowerCase() || value.userId !== userId) throw Error("prompt_application_journal_scope_invalid");
  return value;
}
export function startApplicationJournal(raw: PromptApplicationJournal) {
  const next = parse(raw);
  if (readApplicationJournal(next.companyId, next.userId)) throw Error("prompt_application_journal_pending");
  const value = JSON.stringify(next), key = applicationJournalKey(next.companyId, next.userId);
  sessionStorage.setItem(key, value);
  if (sessionStorage.getItem(key) !== value) throw Error("prompt_application_journal_write_unconfirmed");
  return next;
}
export function clearApplicationJournal(expected: PromptApplicationJournal) {
  const current = readApplicationJournal(expected.companyId, expected.userId);
  if (!current || JSON.stringify(current) !== JSON.stringify(parse(expected))) throw Error("prompt_application_journal_changed");
  const key = applicationJournalKey(expected.companyId, expected.userId); sessionStorage.removeItem(key);
  if (sessionStorage.getItem(key) !== null) throw Error("prompt_application_journal_clear_unconfirmed");
}
/** Preparation only stores metadata server-side. This does not cancel the server proposal. */
export function abandonApplicationPreparation(expected: PromptApplicationJournal) {
  const value = parse(expected);
  if (value.action !== "prepare" || value.applicationId !== null || value.approvalDigest !== null) throw Error("prompt_application_not_metadata_only");
  clearApplicationJournal(value);
}
