import { useEffect, useMemo, useRef, useState } from "react";
import type { PreparePrivatePromptTest } from "@paperclipai/shared/mimouse-private-prompt-tests";
import { ApiError } from "@/api/client";
import { privatePromptTestsApi, privatePromptDetailSchema, privatePromptResponseSchema, type VerifiedPrivatePromptDetail, type VerifiedPrivatePromptRecord } from "@/api/private-prompt-tests";
import { readPrivatePromptJournal, replacePrivatePromptJournal, clearPrivatePromptJournal, verifyPrivatePromptBinding, type PrivatePromptJournal } from "@/lib/private-prompt-journal";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/i18n";
type Props = { companyId: string; userId: string; sessionId: string; promptId: string | null; revisionId: string | null; headReceiptId: string | null; authPending?: boolean; onPendingChange: (pending: boolean) => void; onAccessLost: () => void };
const fields = ["agentId", "datasetId", "caseId", "skillVersionId"] as const;
type Draft = Record<typeof fields[number], string>;
const empty: Draft = { agentId: "", datasetId: "", caseId: "", skillVersionId: "" };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const acceptedStates = ["pending_harness", "pending_wake", "queued", "prepared", "spawned"];
const terminalStates = ["completed", "failed", "cancelled"];
/** Stable owner/company controller; selections never own an unresolved operation. */
export function PrivatePromptTests(props: Props) {
  if (!props.companyId || !props.userId || !props.sessionId) return null;
  return <PrivateTestSession key={JSON.stringify([props.companyId, props.userId, props.sessionId])} {...props} />;
}
function PrivateTestSession(props: Props) {
  const { t } = useTranslation(), label = (key: string) => t(`privatePromptTestsUi.${key}`);
  const live = useRef(true), generation = useRef(0), writeLock = useRef<string | null>(null), authPending = useRef(props.authPending);
  authPending.current = props.authPending;
  const controller = useMemo(() => new AbortController(), [props.authPending]);
  const currentController = useRef(controller); currentController.current = controller;
  const api = useMemo(() => privatePromptTestsApi(props.companyId, controller.signal), [props.companyId, controller]);
  const [enabled, setEnabled] = useState(false), [items, setItems] = useState<VerifiedPrivatePromptRecord[]>([]), [nextPage, setNextPage] = useState<string | null>(null);
  const [detail, setDetail] = useState<VerifiedPrivatePromptDetail | null>(null), [draft, setDraft] = useState<Draft>(empty);
  const [checks, setChecks] = useState([false, false, false]), [busy, setBusy] = useState(true), [failed, setFailed] = useState(false), [notice, setNotice] = useState("");
  const [journal, setJournal] = useState<PrivatePromptJournal | null>(null), [storageFailed, setStorageFailed] = useState(false);
  function active() { return live.current && !authPending.current && currentController.current === controller && !controller.signal.aborted; }
  function adopt(value: PrivatePromptJournal | null) { setJournal(value); props.onPendingChange(Boolean(value)); }
  function storageFailure() { setStorageFailed(true); setEnabled(false); setDetail(null); setChecks([false, false, false]); props.onPendingChange(true); setNotice("storageFailed"); }
  useEffect(() => {
    live.current = true; writeLock.current = null; ++generation.current; setDetail(null); setItems([]); setChecks([false, false, false]);
    if (!props.authPending) void refresh();
    return () => { live.current = false; ++generation.current; queueMicrotask(() => { if (!live.current || currentController.current !== controller) controller.abort(); }); }; // Never clear durable identity on unmount.
  }, [controller]);
  useEffect(() => { if (active()) { ++generation.current; setDetail(null); setChecks([false, false, false]); void refresh(); } }, [props.promptId, props.revisionId, props.headReceiptId]);
  function rejectRead(error: unknown) {
    if (!active()) return;
    setFailed(true); setEnabled(false); setDetail(null); setItems([]); setChecks([false, false, false]); setNotice("readFailed");
    if (error instanceof ApiError && [401, 403].includes(error.status)) { setDraft(empty); props.onAccessLost(); }
  }
  function reconcile(raw: unknown, expected: PrivatePromptJournal, source: "read" | "prepare" | "execute" | "cancel") {
    const row = verifyPrivatePromptBinding(raw, expected);
    if (!active()) return null;
    const current = readPrivatePromptJournal(props.companyId, props.userId);
    if (current?.operationId !== expected.operationId) return null;
    if (terminalStates.includes(row.status)) { clearPrivatePromptJournal(expected); adopt(null); }
    else if (expected.phase === "prepare_pending") {
      if (source !== "prepare" || row.status !== "awaiting_confirmation") throw Error("private_prepare_state_invalid");
      adopt(replacePrivatePromptJournal({ ...expected, testId: row.id, approvalDigest: row.approvalDigest, phase: "awaiting_confirmation" }, expected.operationId));
    } else if (acceptedStates.includes(row.status) && expected.phase !== "accepted") {
      adopt(replacePrivatePromptJournal({ ...expected, phase: "accepted" }, expected.operationId));
    }
    // Unknown is never cleared. In particular, GET awaiting cannot invalidate a delayed execute.
    return row;
  }
  async function refresh(more = false) {
    const epoch = ++generation.current; setBusy(true); setDetail(null); setChecks([false, false, false]);
    let pending: PrivatePromptJournal | null;
    try { pending = readPrivatePromptJournal(props.companyId, props.userId); adopt(pending); setStorageFailed(false); }
    catch { storageFailure(); setBusy(false); return; }
    try {
      const caps = await api.capabilities();
      if (!active() || epoch !== generation.current) return;
      setEnabled(caps.enabled === true && caps.profile === "claude_cli_bare_api_key_v1" && caps.toolsEnabled === false && caps.completeContextCaptured === false);
      if (pending?.testId) {
        const value = privatePromptDetailSchema.parse(await api.detail(pending.promptId, pending.testId));
        if (!active() || epoch !== generation.current) return;
        if (reconcile(value.item, pending, "read")) setDetail(value);
      } else if (props.promptId) {
        const page = await api.list(props.promptId, more ? nextPage : null);
        if (!active() || epoch !== generation.current) return;
        if (page.items.some(row => row.companyId !== props.companyId || row.actorUserId !== props.userId || row.promptId !== props.promptId)) throw Error("private_list_binding_invalid");
        setItems(old => more ? [...old, ...page.items.filter(row => !old.some(item => item.id === row.id))] : page.items); setNextPage(page.nextBeforeId);
      }
      setFailed(false); setNotice(old => old === "readFailed" ? "" : old);
    } catch (error) { if (epoch === generation.current) rejectRead(error); }
    finally { if (active() && epoch === generation.current) setBusy(false); }
  }
  async function inspect(id: string) {
    if (!props.promptId) return;
    const epoch = ++generation.current; setBusy(true); setDetail(null); setChecks([false, false, false]);
    try {
      const value = privatePromptDetailSchema.parse(await api.detail(props.promptId, id));
      if (!active() || epoch !== generation.current) return;
      if (value.item.id !== id || value.item.promptId !== props.promptId || value.item.companyId !== props.companyId || value.item.actorUserId !== props.userId) throw Error("private_result_binding_invalid");
      setDetail(value);
    } catch (error) { if (epoch === generation.current) rejectRead(error); }
    finally { if (active() && epoch === generation.current) setBusy(false); }
  }
  function persistAttempt(next: PrivatePromptJournal, expected: PrivatePromptJournal | null) {
    const saved = replacePrivatePromptJournal({ ...next, operationId: crypto.randomUUID() }, expected?.operationId ?? null); adopt(saved); return saved;
  }
  async function prepare() {
    if (!active() || writeLock.current || !props.promptId || !props.revisionId) return;
    const next: PrivatePromptJournal = { version: 1, companyId: props.companyId, userId: props.userId, originSessionId: props.sessionId, operationId: crypto.randomUUID(),
      promptId: props.promptId, requestId: crypto.randomUUID(), revisionId: props.revisionId, headReceiptId: props.headReceiptId,
      ...draft, executionProfile: "claude_cli_bare_api_key_v1", phase: "prepare_pending", testId: null, approvalDigest: null };
    await post("prepare", next, null);
  }
  async function post(kind: "prepare" | "execute" | "cancel", original: PrivatePromptJournal, expected: PrivatePromptJournal | null = original) {
    if (!active() || writeLock.current || storageFailed || (kind === "execute" && (!enabled || !checks.every(Boolean)))) return;
    if (kind === "execute" && (!detail?.item.approvalSnapshot || detail.item.id !== original.testId || detail.item.approvalDigest !== original.approvalDigest || !["awaiting_confirmation", "pending_harness", "pending_wake"].includes(detail.item.status))) return;
    writeLock.current = "persisting"; ++generation.current; setBusy(true); setChecks([false, false, false]); setNotice("");
    let saved: PrivatePromptJournal;
    try { saved = persistAttempt({ ...original, phase: kind === "prepare" ? "prepare_pending" : kind === "execute" ? "execute_pending" : "cancel_pending" }, expected); writeLock.current = saved.operationId; }
    catch { storageFailure(); writeLock.current = null; setBusy(false); return; } // No POST if storage cannot retain its identity.
    try {
      const prepareBody: PreparePrivatePromptTest = { requestId: saved.requestId, revisionId: saved.revisionId, expectedHeadReceiptId: saved.headReceiptId, agentId: saved.agentId, datasetId: saved.datasetId, caseId: saved.caseId, skillVersionId: saved.skillVersionId, executionProfile: saved.executionProfile };
      const response = kind === "prepare" ? await api.prepare(saved.promptId, prepareBody) : kind === "execute"
        ? await api.execute(saved.promptId, saved.testId!, { approvalDigest: saved.approvalDigest!, executionProfile: saved.executionProfile, confirmRestrictedProfile: true, confirmExecution: true, confirmPossibleCharges: true })
        : await api.cancel(saved.promptId, saved.testId!, { approvalDigest: saved.approvalDigest! });
      if (!active()) return;
      const verified = privatePromptResponseSchema.parse(response), row = reconcile(verified.item, saved, kind);
      if (row) { setDetail({ item: row, privateResult: null, contentDisposition: "untrusted_inert_text" }); setFailed(false); setNotice(kind === "prepare" ? "ticketReady" : "saved"); }
    } catch (error) {
      if (!active()) return;
      setNotice("unknown"); setChecks([false, false, false]);
      if (error instanceof ApiError && [401, 403].includes(error.status)) rejectRead(error);
      // No HTTP status, malformed body or binding mismatch can discard the journal.
    } finally { if (writeLock.current === saved.operationId) writeLock.current = null; if (active()) setBusy(false); }
  }
  function adoptHistoryTicket() {
    if (!detail || journal || storageFailed || detail.item.status !== "awaiting_confirmation" || !detail.item.approvalSnapshot) return;
    const row = detail.item;
    try { adopt(replacePrivatePromptJournal({ version: 1, companyId: props.companyId, userId: props.userId, originSessionId: props.sessionId, operationId: crypto.randomUUID(),
      promptId: row.promptId, requestId: row.requestId, revisionId: row.revisionId, headReceiptId: row.headReceiptId, agentId: row.agentId, datasetId: row.datasetId, caseId: row.caseId, skillVersionId: row.skillVersionId,
      executionProfile: row.executionProfile, testId: row.id, approvalDigest: row.approvalDigest, phase: "awaiting_confirmation" }, null)); setChecks([false, false, false]); }
    catch { storageFailure(); }
  }
  const canConfirm = journal && detail?.item.approvalSnapshot && detail?.item.id === journal.testId && detail.item.status === "awaiting_confirmation" && journal.phase === "awaiting_confirmation";
  const canRecoverExecute = detail?.item.approvalSnapshot && journal?.phase === "execute_pending" && detail?.item.status === "awaiting_confirmation";
  const canContinue = journal?.phase === "accepted" && detail?.item.approvalSnapshot && ["pending_harness", "pending_wake"].includes(detail.item.status);
  const canCancel = journal?.testId && ["awaiting_confirmation", "execute_pending", "cancel_pending"].includes(journal.phase) && detail?.item.status === "awaiting_confirmation";
  const valid = fields.every(field => uuid.test(draft[field])) && Boolean(props.revisionId && uuid.test(props.revisionId));
  const status = (value: string) => label(`status_${value}`);
  return <section className="space-y-3 border-t border-border pt-4" aria-label={label("title")}>
    <h2 className="text-lg font-semibold">{label("title")}</h2>
    <p>{label("boundary")}</p><p className="text-sm text-muted-foreground">{label("profile")}</p><p className="text-sm text-muted-foreground">{label("contextBoundary")}</p><p className="text-sm text-muted-foreground">{label("textOnlyBoundary")}</p>
    <p>{label("twoPhase")}</p>
    {notice && <p role="status">{label(notice)}</p>}
    {journal && <p className="break-all font-mono">{label("pendingTicket")}: {journal.testId ?? journal.requestId}<br />{label("revision")}: {journal.revisionId}<br />{label("receipt")}: {journal.headReceiptId ?? "—"}</p>}
    {failed ? <p role="alert">{label("readFailed")}</p> : <>
      {!busy && !enabled && <p role="status">{label("disabled")}</p>}
      <fieldset disabled={!enabled || busy || Boolean(journal) || storageFailed || props.authPending || !props.promptId} className="space-y-2">
        <p className="break-all font-mono">{label("revision")}: {props.revisionId ?? "—"}<br />{label("receipt")}: {props.headReceiptId ?? "—"}</p>
        {fields.map(field => <label className="block" key={field}>{label(field)}<input aria-label={label(field)} className="block w-full rounded-md border border-border bg-background p-2 font-mono" value={draft[field]} onChange={event => setDraft(old => ({ ...old, [field]: event.target.value }))} /></label>)}
        <div className="flex items-center justify-between gap-2"><Button variant="outline" onClick={() => setDraft(empty)}>{label("clear")}</Button><Button disabled={!valid} onClick={() => void prepare()}>{label("prepare")}</Button></div>
      </fieldset>
      {detail && <div className="space-y-2">
        <p className="break-all font-mono">{detail.item.id} · {status(detail.item.status)}<br />{label("approvalDigest")}: {detail.item.approvalDigest}</p>
        {detail.item.approvalSnapshot ? <div className="space-y-2">
          <h3 className="font-medium">{label("snapshotTitle")}</h3>
          <dl className="font-mono">
            <dt>{label("snapshotModel")}</dt><dd>{detail.item.approvalSnapshot.adapterType} / {detail.item.approvalSnapshot.engine} / {detail.item.approvalSnapshot.model}</dd>
            <dt>{label("snapshotTarget")}</dt><dd className="break-all">{detail.item.approvalSnapshot.configuredCwd ?? label("snapshotCwdUnresolved")}</dd>
            <dt>{label("snapshotEnvironment")}</dt><dd className="break-all">{detail.item.approvalSnapshot.environment.driver} / {detail.item.approvalSnapshot.environment.source} / {detail.item.approvalSnapshot.environment.id}</dd>
            <dt>{label("snapshotCredential")}</dt><dd className="break-all">{detail.item.approvalSnapshot.credential.secretId} / v{detail.item.approvalSnapshot.credential.version}</dd>
            <dt>{label("snapshotConfigDigest")}</dt><dd className="break-all">{detail.item.approvalSnapshot.configDigest}</dd>
          </dl><p>{label("snapshotRestrictions")}</p>
        </div> : <p role="status">{label("snapshotUnavailable")}</p>}
        <dl className="font-mono">{fields.map(field => <div key={field} className="break-all"><dt>{label(field)}</dt><dd>{detail.item[field]}</dd></div>)}</dl>
        {detail.item.prepared && <><p>{label("preparedBoundary")}</p><p className="break-all font-mono">SHA-256: {detail.item.prepared.promptHash}</p>{detail.item.prepared.runtimeConfigHash && <p className="break-all font-mono">{label("runtimeHash")}: {detail.item.prepared.runtimeConfigHash}</p>}</>}
        {detail.item.spawnedAt && <p>{label("spawnedBoundary")}</p>}{detail.item.status === "completed" && <p>{label("completedBoundary")}</p>}
        {detail.item.errorCode && <p role="alert">{label("resultUnavailable")}</p>}
        {detail.privateResult && <><p>{label("resultBoundary")}</p><pre className="whitespace-pre-wrap break-words rounded-md border border-border p-3">{JSON.stringify(detail.privateResult, null, 2)}</pre></>}
        {!journal && detail.item.status === "awaiting_confirmation" && detail.item.approvalSnapshot && <Button disabled={busy || storageFailed} onClick={adoptHistoryTicket}>{label("resumeTicket")}</Button>}
      </div>}
      {(canConfirm || canRecoverExecute || canContinue) && <fieldset disabled={!enabled || busy || storageFailed || props.authPending} className="space-y-2">
        {["confirmProfile", "confirmExecution", "confirmCharges"].map((key, index) => <label key={key} className="flex items-start gap-2"><input aria-label={label(key)} type="checkbox" checked={checks[index]} onChange={event => setChecks(old => old.map((value, position) => position === index ? event.target.checked : value))} /><span>{label(key)}</span></label>)}
        <Button disabled={!checks.every(Boolean)} onClick={() => void post("execute", journal!)}>{label(canContinue ? "continueExecution" : canRecoverExecute ? "retryExecute" : "execute")}</Button>
      </fieldset>}
      {canCancel && <Button variant="outline" disabled={busy || storageFailed || props.authPending} onClick={() => void post("cancel", journal!)}>{label("cancelTicket")}</Button>}
      {!journal && <><h3 className="font-medium">{label("history")}</h3><p className="text-sm text-muted-foreground">{label("order")}</p><ul>{items.map(item => <li key={item.id} className="break-all"><Button variant="outline" disabled={busy} onClick={() => void inspect(item.id)}>{item.id}</Button> {status(item.status)}</li>)}</ul>{nextPage && <Button variant="outline" disabled={busy} onClick={() => void refresh(true)}>{label("more")}</Button>}</>}
    </>}
    {journal?.phase === "prepare_pending" && <Button disabled={busy || storageFailed || props.authPending} onClick={() => void post("prepare", journal)}>{label("recoverPrepare")}</Button>}
    <Button variant="outline" disabled={busy || props.authPending} onClick={() => void refresh()}>{label("refresh")}</Button>
  </section>;
}
