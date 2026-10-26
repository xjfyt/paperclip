import { useEffect, useMemo, useRef, useState } from "react";
import type { CreatePromptRevision, SelectPromptRevision, PromptRegistryHead, PromptRevision, PromptSelectionReceipt } from "@paperclipai/shared/mimouse-prompt-registry";
import { ApiError } from "@/api/client";
import { promptRegistryApi, type PromptDetail } from "@/api/prompt-registry";
import { useTranslation } from "@/i18n";
import { Button } from "@/components/ui/button";
import { PrivatePromptTests } from "./PrivatePromptTests";
type Identity = { companyId: string; userId: string; sessionId: string };
type Intent = { kind: "create"; body: CreatePromptRevision } | { kind: "select"; promptId: string; body: SelectPromptRevision };
/** Mount only with actual session identity, never an API key/implicit fallback.
 * Remounting isolates every draft, request, confirmation and response by session. */
export function MimousePromptRegistry(props: Identity) {
  const { t } = useTranslation();
  if (!props.companyId || !props.userId || !props.sessionId) return <p role="alert">{t("promptRegistryUi.denied")}</p>;
  return <RegistrySession key={JSON.stringify([props.companyId, props.userId, props.sessionId])} {...props} />;
}
function RegistrySession({ companyId, userId, sessionId }: Identity) {
  const { t } = useTranslation(), live = useRef(true), controller = useMemo(() => new AbortController(), []);
  const api = useMemo(() => promptRegistryApi(companyId, controller.signal), [companyId, controller]);
  const [heads, setHeads] = useState<PromptRegistryHead[]>([]), [headNext, setHeadNext] = useState<string | null>(null);
  const [head, setHead] = useState<PromptRegistryHead | null>(null), [revisions, setRevisions] = useState<PromptRevision[]>([]), [receipts, setReceipts] = useState<PromptSelectionReceipt[]>([]);
  const [revisionNext, setRevisionNext] = useState<string | null>(null), [receiptNext, setReceiptNext] = useState<string | null>(null), [detail, setDetail] = useState<PromptDetail | null>(null);
  const [promptKey, setPromptKey] = useState(""), [content, setContent] = useState(""), [target, setTarget] = useState("");
  const [action, setAction] = useState<"promote" | "rollback">("promote"), [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(true), [failed, setFailed] = useState(false), [notice, setNotice] = useState("");
  const [privatePending, setPrivatePending] = useState(false);
  const [intent, setIntent] = useState<Intent | null>(null), writeLock = useRef(false), readGeneration = useRef(0);
  useEffect(() => { live.current = true; void refresh(); return () => { live.current = false; queueMicrotask(() => { if (!live.current) controller.abort(); }); }; }, []);
  useEffect(() => {
    if (!intent) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [intent]);
  function invalidate(error: unknown) {
    if (!live.current) return;
    setFailed(true); setHeads([]); setHead(null); setRevisions([]); setReceipts([]); setDetail(null); setTarget(""); setConfirmed(false);
    if (error instanceof ApiError && [401, 403].includes(error.status)) { setContent(""); setPromptKey(""); setIntent(null); }
    setNotice("denied");
  }
  async function refresh() {
    const generation = ++readGeneration.current; setBusy(true); setConfirmed(false); setDetail(null);
    try { const result = await api.list(); if (!live.current || generation !== readGeneration.current) return;
      setHeads(result.items); setHeadNext(result.nextBeforeId); setHead(null); setRevisions([]); setReceipts([]); setTarget(""); setFailed(false); setNotice(old => old === "denied" ? "" : old);
    } catch (error) { if (generation === readGeneration.current) invalidate(error); }
    finally { if (live.current && generation === readGeneration.current) setBusy(false); }
  }
  async function inspect(id: string) {
    const generation = ++readGeneration.current; setBusy(true); setConfirmed(false); setDetail(null); setTarget(""); setHead(null);
    try { const rev = await api.revisions(id), rec = await api.receipts(id);
      if (!live.current || generation !== readGeneration.current) return;
      // The last response supplies the latest authoritative head, never list order.
      setHead(rec.head); setRevisions(rev.items); setRevisionNext(rev.nextBeforeId); setReceipts(rec.items); setReceiptNext(rec.nextBeforeId); setFailed(false);
    } catch (error) { if (generation === readGeneration.current) invalidate(error); }
    finally { if (live.current && generation === readGeneration.current) setBusy(false); }
  }
  async function readMore(kind: "heads" | "revisions" | "receipts" | "content", revisionId?: string) {
    const generation = ++readGeneration.current; setBusy(true); setConfirmed(false);
    try {
      if (kind === "heads") { const result = await api.list(headNext); if (!live.current || generation !== readGeneration.current) return; setHeads(old => [...old, ...result.items.filter(item => !old.some(value => value.id === item.id))]); setHeadNext(result.nextBeforeId); }
      else if (head && kind === "content") { const result = await api.content(head.id, revisionId!); if (!live.current || generation !== readGeneration.current) return; setDetail(result); setTarget(result.id); }
      else if (head && kind === "revisions") { const result = await api.revisions(head.id, revisionNext); if (!live.current || generation !== readGeneration.current) return; setHead(result.head); setRevisions(old => [...old, ...result.items.filter(item => !old.some(value => value.id === item.id))]); setRevisionNext(result.nextBeforeId); }
      else if (head) { const result = await api.receipts(head.id, receiptNext); if (!live.current || generation !== readGeneration.current) return; setHead(result.head); setReceipts(old => [...old, ...result.items.filter(item => !old.some(value => value.id === item.id))]); setReceiptNext(result.nextBeforeId); }
    } catch (error) { if (generation === readGeneration.current) invalidate(error); }
    finally { if (live.current && generation === readGeneration.current) setBusy(false); }
  }
  async function submit(next: Intent) {
    if (writeLock.current) return; writeLock.current = true; setBusy(true); setIntent(next); setNotice(""); setConfirmed(false);
    try {
      const result = next.kind === "create" ? await api.create(next.body) : await api.select(next.promptId, next.body);
      if (!live.current) return;
      setIntent(null); setNotice(`saved:${result.item.id}`); if (next.kind === "create") setContent("");
      // Always reload current head; an idempotency receipt may be historical.
      await refresh();
    } catch (error) {
      if (!live.current) return;
      if (error instanceof ApiError && [401, 403].includes(error.status)) invalidate(error);
      else if (error instanceof ApiError && [400, 404, 409].includes(error.status)) { setIntent(null); setNotice(error.status === 409 ? "conflict" : "rejected"); await refresh(); }
      else setNotice("unknown"); // exact body/request ID is frozen until recovered
    } finally { writeLock.current = false; if (live.current) setBusy(false); }
  }
  const currentReceipt = receipts.find(item => item.id === head?.headReceiptId);
  const canSelect = head && (action === "promote" ? Boolean(detail && target === detail.id && target !== head.selectedRevisionId) : Boolean(currentReceipt));
  const label = (key: string) => t(`promptRegistryUi.${key}`);
  return <section className="space-y-4">
    <h1 className="text-xl font-semibold">{label("title")}</h1><p>{label("boundary")}</p>
    {notice && <p role="status">{notice.startsWith("saved:") ? `${label("saved")} ${notice.slice(6)}` : label(notice)}</p>}
    {failed ? <p role="alert">{label("denied")}</p> : <>
      <p className="text-sm text-muted-foreground">{label("order")}</p>
      <fieldset disabled={busy || Boolean(intent) || privatePending} className="space-y-2">
        <label className="block">{label("key")}<input aria-label={label("key")} className="block rounded-md border border-border bg-background p-2" value={promptKey} onChange={event => setPromptKey(event.target.value)} /></label>
        <label className="block">{label("content")}<textarea aria-label={label("content")} className="block w-full rounded-md border border-border bg-background p-2 font-mono" value={content} onChange={event => setContent(event.target.value)} /></label>
        <Button disabled={!/^[a-z][a-z0-9_-]{0,79}$/.test(promptKey) || !content} onClick={() => void submit({ kind: "create", body: { requestId: crypto.randomUUID(), promptKey, content } })}>{label("create")}</Button>
        <ul>{heads.map(item => <li key={item.id}><Button variant="outline" onClick={() => void inspect(item.id)}>{item.promptKey}</Button><span className="break-all"> {label("selected")}: {item.selectedRevisionId ?? "—"}</span></li>)}</ul>
        {headNext && <Button variant="outline" onClick={() => void readMore("heads")}>{label("moreHeads")}</Button>}
        {head && <div className="space-y-3 border-t border-border pt-4">
          <p className="break-all">{head.promptKey} · {label("selected")}: {head.selectedRevisionId ?? "—"}<br />{label("head")}: {head.headReceiptId ?? "—"}</p>
          {head.selectedRevisionId && <Button variant="outline" onClick={() => void readMore("content", head.selectedRevisionId!)}>{label("viewSelected")}</Button>}
          <h2 className="font-medium">{label("revisions")}</h2>
          <ul>{revisions.map(item => <li className="break-all" key={item.id}><Button variant="outline" onClick={() => void readMore("content", item.id)}>{item.id}</Button> {item.contentHash}</li>)}</ul>
          {revisionNext && <Button variant="outline" onClick={() => void readMore("revisions")}>{label("moreRevisions")}</Button>}
          {detail && <div><p className="break-all">{detail.id} · {detail.contentHash}</p><pre className="whitespace-pre-wrap break-words rounded-md border border-border p-3">{detail.content}</pre></div>}
          <label>{label("action")} <select value={action} onChange={event => { setAction(event.target.value as typeof action); setConfirmed(false); }}><option value="promote">{label("promote")}</option><option value="rollback">{label("rollback")}</option></select></label>
          <p className="break-all">{label("target")}: {action === "promote" ? target || "—" : currentReceipt?.beforeRevisionId ?? "—"}</p>
          {action === "rollback" && !currentReceipt && <p>{label("loadReceipt")}</p>}
          <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} disabled={!canSelect} onChange={event => setConfirmed(event.target.checked)} /><span>{label("confirm")}</span></label>
          <Button disabled={!confirmed || !canSelect} onClick={() => void submit({ kind: "select", promptId: head.id, body: action === "promote" ? { requestId: crypto.randomUUID(), action, revisionId: target, expectedHeadReceiptId: head.headReceiptId, confirmRegistryOnly: true } : { requestId: crypto.randomUUID(), action, rollbackOfReceiptId: head.headReceiptId!, expectedHeadReceiptId: head.headReceiptId, confirmRegistryOnly: true } })}>{label("select")}</Button>
          <h2 className="font-medium">{label("receipts")}</h2>
          <ul>{receipts.map(item => <li className="break-all" key={item.id}>{item.id} · {label(item.action)} · {item.beforeRevisionId ?? "—"} → {item.selectedRevisionId ?? "—"}<br />{label("previous")}: {item.previousReceiptId ?? "—"}</li>)}</ul>
          {receiptNext && <Button variant="outline" onClick={() => void readMore("receipts")}>{label("moreReceipts")}</Button>}
        </div>}
      </fieldset>
      {head && detail && !intent && <PrivatePromptTests {...{ companyId, userId, sessionId }} promptId={head.id} revisionId={detail.id} headReceiptId={head.headReceiptId} onPendingChange={setPrivatePending} onAccessLost={() => invalidate(new ApiError("forbidden", 403, null))} />}
      {intent && <div className="space-y-2"><p>{label("unknown")}</p><p className="break-all">{intent.body.requestId}</p><Button disabled={busy} onClick={() => void submit(intent)}>{label("recover")}</Button></div>}
    </>}
    <Button variant="outline" disabled={busy || privatePending} onClick={() => void refresh()}>{label("refresh")}</Button>
  </section>;
}
