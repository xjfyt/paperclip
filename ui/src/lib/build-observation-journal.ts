import { startMimouseBuildObservationSchema, type MimouseBuildObservationRequestOutcome, type StartMimouseBuildObservationInput } from "@paperclipai/shared";

export interface BuildObservationJournalScope { companyId: string; userId: string; deliveryId: string }
type JournalStorage = Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem">;
const namespace = "paperclip:build-observation-pending:v1:";
function unavailable(): never { throw Error("observation_journal_unavailable"); }
function prefix(scope: BuildObservationJournalScope) {
  const values = [scope.companyId, scope.userId, scope.deliveryId];
  if (values.some(value => !value || value.length > 200 || /[\u0000-\u001f\u007f]/.test(value))) unavailable();
  return `${namespace}${values.map(encodeURIComponent).join(":")}:`;
}
export function sameBuildObservationInput(left: StartMimouseBuildObservationInput, right: unknown): boolean {
  const parsed = startMimouseBuildObservationSchema.safeParse(right);
  return parsed.success && left.requestId === parsed.data.requestId && left.profileId === parsed.data.profileId
    && left.jobId === parsed.data.jobId && left.expectedBinding === parsed.data.expectedBinding;
}
function serialized(input: StartMimouseBuildObservationInput): string { return JSON.stringify(startMimouseBuildObservationSchema.parse(input)); }
/** Stable company/user/delivery scope intentionally excludes session, auth epoch
 * and SHA. Independent request keys never overwrite another tab's unresolved ID.
 * Browser storage is not an atomic cross-tab lock or an exactly-once guarantee. */
export function readBuildObservationJournal(scope: BuildObservationJournalScope, storage: JournalStorage = localStorage): StartMimouseBuildObservationInput[] {
  try {
    const start = prefix(scope); const length = storage.length;
    if (!Number.isSafeInteger(length) || length < 0 || length > 2048) unavailable();
    const found: Array<{ key: string; input: StartMimouseBuildObservationInput }> = []; const seen = new Set<string>();
    for (let index = 0; index < length; index++) {
      const key = storage.key(index); if (key === null || seen.has(key)) unavailable(); seen.add(key);
      if (!key.startsWith(start)) continue;
      if (found.length >= 16) unavailable();
      const raw = storage.getItem(key); if (raw === null || raw.length > 1024) unavailable();
      const value: unknown = JSON.parse(raw); const input = startMimouseBuildObservationSchema.parse(value);
      // Only our canonical four-field serialization is accepted, including key spelling/order.
      if (raw !== serialized(input) || key !== `${start}${input.requestId}`) unavailable();
      found.push({ key, input });
    }
    if (storage.length !== length) unavailable();
    return found.sort((a, b) => a.key.localeCompare(b.key)).map(item => item.input);
  } catch { return unavailable(); }
}
/** Must succeed before EVERY POST. A failed read/write/readback is never bypassed. */
export function ensureBuildObservationJournal(scope: BuildObservationJournalScope, input: StartMimouseBuildObservationInput, storage: JournalStorage = localStorage) {
  try {
    const entries = readBuildObservationJournal(scope, storage); const existing = entries.find(entry => entry.requestId === input.requestId);
    if (existing && !sameBuildObservationInput(input, existing) || !existing && entries.length) unavailable();
    const key = `${prefix(scope)}${input.requestId}`; const raw = serialized(input);
    if (!existing) storage.setItem(key, raw);
    if (storage.getItem(key) !== raw) unavailable();
    const after = readBuildObservationJournal(scope, storage);
    if (!after.some(entry => sameBuildObservationInput(input, entry)) || !existing && after.length !== 1) unavailable();
  } catch { unavailable(); }
}
export function matchingBuildObservationOutcome(input: StartMimouseBuildObservationInput, result: MimouseBuildObservationRequestOutcome | null | undefined): result is MimouseBuildObservationRequestOutcome {
  return Boolean(result && result.requestId === input.requestId && sameBuildObservationInput(input, result.input)
    && ["running", "retryable", "terminal", "interrupted"].includes(result.state));
}
export function durableBuildObservationTerminal(scope: BuildObservationJournalScope, input: StartMimouseBuildObservationInput, result: MimouseBuildObservationRequestOutcome): boolean {
  return matchingBuildObservationOutcome(input, result) && result.state === "terminal" && Boolean(result.receipt
    && result.receipt.requestId === input.requestId && result.receipt.deliveryId === scope.deliveryId
    && result.receipt.profileId === input.profileId && result.receipt.id && result.receipt.admission === "blocked");
}
/** Never clear on 404/null/interrupted/current-other-ID or a mere transport result. */
export function clearBuildObservationJournal(scope: BuildObservationJournalScope, input: StartMimouseBuildObservationInput,
  result: MimouseBuildObservationRequestOutcome, storage: JournalStorage = localStorage) {
  try {
    if (!durableBuildObservationTerminal(scope, input, result)) unavailable();
    const key = `${prefix(scope)}${input.requestId}`; const raw = serialized(input);
    if (storage.getItem(key) !== raw) unavailable();
    storage.removeItem(key);
    if (storage.getItem(key) !== null || readBuildObservationJournal(scope, storage).some(entry => entry.requestId === input.requestId)) unavailable();
  } catch { unavailable(); }
}
