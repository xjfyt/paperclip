import { useEffect, useMemo, useRef, useState } from "react";
import type { CreatePrivatePromptTest, PrivatePromptTestCapabilities, PrivatePromptTestDetail, PrivatePromptTestRecord } from "@paperclipai/shared/mimouse-private-prompt-tests";
import { ApiError } from "@/api/client";
import { privatePromptTestsApi } from "@/api/private-prompt-tests";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/i18n";
type Props = { companyId: string; userId: string; sessionId: string; promptId: string; revisionId: string; headReceiptId: string | null; onPendingChange: (pending: boolean) => void; onAccessLost: () => void };
const fields = ["agentId", "datasetId", "caseId", "skillVersionId"] as const;
type Draft = Record<typeof fields[number], string>;
const empty: Draft = { agentId: "", datasetId: "", caseId: "", skillVersionId: "" };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** No prompt text, storage, global cache or automatic execution enters this panel. */
export function PrivatePromptTests(props: Props) {
  if (!props.companyId || !props.userId || !props.sessionId) return null;
  return <PrivateTestSession key={JSON.stringify([props.companyId, props.userId, props.sessionId, props.promptId, props.revisionId, props.headReceiptId])} {...props} />;
}
function PrivateTestSession(props: Props) {
  const { t } = useTranslation(), label = (key: string) => t(`privatePromptTestsUi.${key}`);
  const live = useRef(true), generation = useRef(0), writeLock = useRef(false);
  const controller = useMemo(() => new AbortController(), []);
  const api = useMemo(() => privatePromptTestsApi(props.companyId, controller.signal), [props.companyId, controller]);
  const [caps, setCaps] = useState<PrivatePromptTestCapabilities | null>(null), [items, setItems] = useState<PrivatePromptTestRecord[]>([]), [nextPage, setNextPage] = useState<string | null>(null);
  const [detail, setDetail] = useState<PrivatePromptTestDetail | null>(null), [draft, setDraft] = useState<Draft>(empty);
  const [checks, setChecks] = useState([false, false, false]), [busy, setBusy] = useState(true), [failed, setFailed] = useState(false), [notice, setNotice] = useState("");
  const [intent, setIntent] = useState<CreatePrivatePromptTest | null>(null);
  useEffect(() => { live.current = true; void refresh(); return () => { live.current = false; props.onPendingChange(false); queueMicrotask(() => { if (!live.current) controller.abort(); }); }; }, []);
  useEffect(() => {
    if (!intent) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", guard); return () => window.removeEventListener("beforeunload", guard);
  }, [intent]);
  function clearIntent() { setIntent(null); props.onPendingChange(false); }
  function rejectRead(error: unknown) {
    if (!live.current) return;
    setFailed(true); setCaps(null); setDetail(null); setItems([]); setNextPage(null); setChecks([false, false, false]); setNotice("readFailed");
    if (error instanceof ApiError && [401, 403].includes(error.status)) { setDraft(empty); clearIntent(); props.onAccessLost(); }
  }
  async function refresh(more = false) {
    const epoch = ++generation.current; setBusy(true); setDetail(null); setChecks([false, false, false]);
    try {
      const capabilities = await api.capabilities(), page = await api.list(props.promptId, more ? nextPage : null);
      if (!live.current || epoch !== generation.current) return;
      setCaps(capabilities); setItems(old => more ? [...old, ...page.items.filter(item => !old.some(row => row.id === item.id))] : page.items); setNextPage(page.nextBeforeId); setFailed(false); setNotice(old => old === "readFailed" ? "" : old); return true;
    } catch (error) { if (epoch === generation.current) rejectRead(error); }
    finally { if (live.current && epoch === generation.current) setBusy(false); }
  }
  async function inspect(id: string) {
    const epoch = ++generation.current; setBusy(true); setDetail(null); setChecks([false, false, false]);
    try {
      const value = await api.detail(props.promptId, id);
      if (!live.current || epoch !== generation.current) return;
      if (value.item.id !== id || value.item.promptId !== props.promptId || value.contentDisposition !== "untrusted_inert_text") throw Error("private_result_binding_invalid");
      setDetail(value);
    } catch (error) { if (epoch === generation.current) rejectRead(error); }
    finally { if (live.current && epoch === generation.current) setBusy(false); }
  }
  async function submit(body: CreatePrivatePromptTest) {
    if (writeLock.current) return;
    writeLock.current = true; ++generation.current; setBusy(true); setIntent(body); props.onPendingChange(true); setChecks([false, false, false]); setDetail(null); setNotice("");
    try {
      const result = await api.create(props.promptId, body);
      if (!live.current) return;
      clearIntent(); setNotice("saved"); const refreshed = await refresh();
      // The returned ID is server-authoritative; queued/prepared is never shown as completed.
      if (refreshed && live.current && result.item.promptId === props.promptId) await inspect(result.item.id);
    } catch (error) {
      if (!live.current) return;
      if (error instanceof ApiError && [401, 403].includes(error.status)) rejectRead(error);
      else if (error instanceof ApiError && [400, 404, 409].includes(error.status)) { clearIntent(); setNotice(error.status === 409 ? "conflict" : "rejected"); await refresh(); }
      else setNotice("unknown"); // Keep exact body/requestId; do not mint another intent.
    } finally { writeLock.current = false; if (live.current) setBusy(false); }
  }
  const enabled = caps?.enabled === true && caps.profile === "claude_cli_bare_api_key_v1" && caps.toolsEnabled === false && caps.completeContextCaptured === false;
  const valid = fields.every(field => uuid.test(draft[field])) && uuid.test(props.revisionId);
  const status = (value: string) => label(`status_${["pending_harness", "pending_wake", "queued", "prepared", "spawned", "completed", "failed", "unknown", "cancelled"].includes(value) ? value : "unknown"}`);
  return <section className="space-y-3 border-t border-border pt-4" aria-label={label("title")}>
    <h2 className="text-lg font-semibold">{label("title")}</h2>
    <p>{label("boundary")}</p><p className="text-sm text-muted-foreground">{label("profile")}</p><p className="text-sm text-muted-foreground">{label("contextBoundary")}</p>
    <p className="text-sm text-muted-foreground">{label("textOnlyBoundary")}</p>
    <p className="break-all font-mono">{label("revision")}: {props.revisionId}<br />{label("receipt")}: {props.headReceiptId ?? "—"}</p>
    {notice && <p role="status">{label(notice)}</p>}
    {failed ? <p role="alert">{label("readFailed")}</p> : <>
      {!busy && !enabled && <p role="status">{label("disabled")}</p>}
      <fieldset disabled={!enabled || busy || Boolean(intent)} className="space-y-2">
        {fields.map(field => <label className="block" key={field}>{label(field)}<input aria-label={label(field)} className="block w-full rounded-md border border-border bg-background p-2 font-mono" value={draft[field]} onChange={event => { setDraft(old => ({ ...old, [field]: event.target.value })); setChecks([false, false, false]); }} /></label>)}
        {["confirmProfile", "confirmExecution", "confirmCharges"].map((key, index) => <label key={key} className="flex items-start gap-2"><input aria-label={label(key)} type="checkbox" checked={checks[index]} onChange={event => setChecks(old => old.map((value, position) => position === index ? event.target.checked : value))} /><span>{label(key)}</span></label>)}
        <div className="flex items-center justify-between gap-2"><Button variant="outline" onClick={() => { setDraft(empty); setChecks([false, false, false]); }}>{label("clear")}</Button><Button disabled={!valid || !checks.every(Boolean)} onClick={() => void submit({ ...draft, requestId: crypto.randomUUID(), revisionId: props.revisionId, expectedHeadReceiptId: props.headReceiptId, executionProfile: "claude_cli_bare_api_key_v1", confirmRestrictedProfile: true, confirmExecution: true, confirmPossibleCharges: true })}>{label("execute")}</Button></div>
      </fieldset>
      <h3 className="font-medium">{label("history")}</h3><p className="text-sm text-muted-foreground">{label("order")}</p>
      <ul>{items.map(item => <li key={item.id} className="break-all"><Button variant="outline" disabled={busy || Boolean(intent)} onClick={() => void inspect(item.id)}>{item.id}</Button> {status(item.status)}</li>)}</ul>
      {nextPage && <Button variant="outline" disabled={busy || Boolean(intent)} onClick={() => void refresh(true)}>{label("more")}</Button>}
      {detail && <div className="space-y-2">
        <p className="break-all font-mono">{detail.item.id} · {status(detail.item.status)}</p>
        {detail.item.prepared && <><p>{label("preparedBoundary")}</p><p className="break-all font-mono">SHA-256: {detail.item.prepared.promptHash}</p></>}
        {detail.item.prepared && "runtimeConfigHash" in detail.item.prepared && typeof detail.item.prepared.runtimeConfigHash === "string" && <p className="break-all font-mono">{label("runtimeHash")}: {detail.item.prepared.runtimeConfigHash}</p>}
        {detail.item.spawnedAt && <p>{label("spawnedBoundary")}</p>}
        {detail.item.status === "completed" && <p>{label("completedBoundary")}</p>}
        {detail.item.errorCode && <p role="alert">{label("resultUnavailable")}</p>}
        {detail.privateResult && <><p>{label("resultBoundary")}</p><pre className="whitespace-pre-wrap break-words rounded-md border border-border p-3">{JSON.stringify(detail.privateResult, null, 2)}</pre></>}
      </div>}
    </>}
    {intent && <div className="space-y-2"><p>{label("unknown")}</p><p className="break-all font-mono">{intent.requestId}</p><Button disabled={busy} onClick={() => void submit(intent)}>{label("recover")}</Button></div>}
    <Button variant="outline" disabled={busy || Boolean(intent)} onClick={() => void refresh()}>{label("refresh")}</Button>
  </section>;
}
