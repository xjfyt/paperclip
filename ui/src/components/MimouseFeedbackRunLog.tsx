import { useLayoutEffect, useRef, useState } from "react";
import { feedbackRunLogReferenceSchema, feedbackRunLogSelectionSchema, RUN_LOG_SOURCE_INSTANCE,
  type FeedbackRunLogImport, type FeedbackRunLogImportReceipt, type FeedbackRunLogPreview, type FeedbackRunLogReference } from "@paperclipai/shared/mimouse-feedback-run-log";
import type { FeedbackInboxItem } from "@paperclipai/shared";
import { api } from "@/api/client";
import { privateFeedbackGet } from "@/api/private-feedback";
import { useTranslation } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
type Scope = { companyId: string; userId: string; sessionId: string };
type Props = Scope & { onImported: (receipt: FeedbackRunLogImportReceipt) => void };
export function isRunLogCandidate(item: FeedbackInboxItem) { return item.sourceKind === "application_log" && item.sourceInstance === RUN_LOG_SOURCE_INSTANCE; }
function useAttemptScope() {
  const alive = useRef(false), attempt = useRef(0), controller = useRef(new AbortController());
  useLayoutEffect(() => { alive.current = true; if (controller.current.signal.aborted) controller.current = new AbortController(); return () => { alive.current = false; attempt.current++; controller.current.abort(); }; }, []);
  return { attempt, controller, current: (value: number) => alive.current && attempt.current === value };
}
export function MimouseFeedbackRunLog(props: Props) {
  return <Launcher key={JSON.stringify([props.companyId, props.userId, props.sessionId])} {...props} />;
}
function Launcher(props: Props) {
  const { t } = useTranslation(), [open, setOpen] = useState(false);
  return <section className="space-y-3 rounded-lg border border-border p-4">
    <h2 className="font-medium">{t("feedbackRunLogUi.title")}</h2><p className="text-sm text-muted-foreground">{t("feedbackRunLogUi.boundary")}</p>
    <Button type="button" variant="outline" disabled={props.userId === "local-board" || !props.sessionId} onClick={() => setOpen(true)}>{t("feedbackRunLogUi.open")}</Button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>{t("feedbackRunLogUi.title")}</DialogTitle><DialogDescription>{t("feedbackRunLogUi.boundary")}</DialogDescription></DialogHeader>
      {open && <ImportReference {...props} onClose={() => setOpen(false)} />}
    </DialogContent></Dialog>
  </section>;
}
function Reference({ reference }: { reference: FeedbackRunLogReference }) {
  const { t } = useTranslation();
  return <div className="space-y-1 break-all text-xs">
    {(["runId", "eventId", "eventSeq", "runCreatedAt", "eventCreatedAt", "referenceDigest"] as const).map(key => <p key={key}>{t(`feedbackRunLogUi.${key}`)}: <span className="font-mono">{reference[key]}</span></p>)}
    <p>{t("feedbackRunLogUi.unknownVersion")}</p><p>{t("feedbackRunLogUi.notReproduced")}</p>
  </div>;
}
function ImportReference({ companyId, onImported, onClose }: Props & { onClose: () => void }) {
  const { t } = useTranslation(), scope = useAttemptScope(), busy = useRef(false);
  const [runId, setRunId] = useState(""), [eventSeq, setEventSeq] = useState("");
  const [preview, setPreview] = useState<FeedbackRunLogPreview | null>(null), [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false), [error, setError] = useState<"previewError" | "importError" | null>(null);
  const [frozen, setFrozen] = useState<FeedbackRunLogImport | null>(null);
  const root = `/companies/${companyId}/feedback-inbox`;
  function change(kind: "run" | "seq", value: string) {
    scope.attempt.current++; busy.current = false; setPending(false); setPreview(null); setConfirmed(false); setFrozen(null); setError(null);
    if (kind === "run") setRunId(value); else setEventSeq(value);
  }
  async function readPreview() {
    if (busy.current) return;
    const selection = feedbackRunLogSelectionSchema.safeParse({ runId, eventSeq: Number(eventSeq) });
    if (!selection.success) { setError("previewError"); return; }
    const attempt = ++scope.attempt.current; busy.current = true; setPending(true); setPreview(null); setConfirmed(false); setFrozen(null); setError(null);
    try {
      const result = await api.post<FeedbackRunLogPreview>(`${root}/run-log-preview`, selection.data);
      if (scope.current(attempt) && result.reference.companyId === companyId && result.reference.runId === selection.data.runId && result.reference.eventSeq === selection.data.eventSeq) setPreview(result);
    } catch { if (scope.current(attempt)) setError("previewError"); }
    finally { if (scope.current(attempt)) { busy.current = false; setPending(false); } }
  }
  async function importReference() {
    if (busy.current || (!frozen && (!preview || !confirmed))) return;
    const payload: FeedbackRunLogImport = frozen ?? { runId: preview!.reference.runId, eventSeq: preview!.reference.eventSeq, previewDigest: preview!.previewDigest, confirm: true };
    const attempt = ++scope.attempt.current; busy.current = true; setPending(true); setFrozen(payload); setError(null);
    try {
      const result = await api.post<FeedbackRunLogImportReceipt>(`${root}/run-log-import`, payload);
      if (scope.current(attempt)) { onImported(result); onClose(); }
    } catch { if (scope.current(attempt)) setError("importError"); }
    finally { if (scope.current(attempt)) { busy.current = false; setPending(false); } }
  }
  return <div className="space-y-3">
    <fieldset disabled={pending || frozen !== null} className="space-y-3">
      <label className="block space-y-1"><span>{t("feedbackRunLogUi.runId")}</span><Input value={runId} onChange={event => change("run", event.target.value)} /></label>
      <label className="block space-y-1"><span>{t("feedbackRunLogUi.eventSeq")}</span><Input type="number" min={1} step={1} value={eventSeq} onChange={event => change("seq", event.target.value)} /></label>
      <Button type="button" variant="outline" onClick={() => void readPreview()}>{t("feedbackRunLogUi.preview")}</Button>
    </fieldset>
    {preview && <><Reference reference={preview.reference} /><label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} disabled={pending || frozen !== null} onChange={event => setConfirmed(event.target.checked)} /><span>{t("feedbackRunLogUi.confirm")}</span></label></>}
    {error && <p role="alert">{t(`feedbackRunLogUi.${error}`)}</p>}
    <div className="flex items-center justify-between gap-2"><Button type="button" variant="outline" onClick={onClose}>{t("feedbackRunLogUi.cancel")}</Button><Button type="button" disabled={pending || (!frozen && (!preview || !confirmed))} onClick={() => void importReference()}>{t(frozen ? "feedbackRunLogUi.retry" : "feedbackRunLogUi.import")}</Button></div>
  </div>;
}
export function MimouseFeedbackRunLogSource(props: Scope & { item: FeedbackInboxItem }) {
  return <Source key={JSON.stringify([props.companyId, props.userId, props.sessionId, props.item.id])} {...props} />;
}
function Source({ companyId, userId, sessionId, item }: Scope & { item: FeedbackInboxItem }) {
  const { t } = useTranslation(), scope = useAttemptScope(), busy = useRef(false);
  const [status, setStatus] = useState<"sourceVerified" | "sourceUnavailable" | null>(null), [pending, setPending] = useState(false);
  let reference: FeedbackRunLogReference | null = null;
  try { reference = feedbackRunLogReferenceSchema.parse(JSON.parse(item.text)); } catch { /* Unsupported internal snapshots are not interpreted as user prose. */ }
  return <div className="space-y-3"><p>{t("feedbackRunLogUi.boundary")}</p>{reference && <Reference reference={reference} />}
    <Button type="button" variant="outline" disabled={pending || userId === "local-board" || !sessionId} onClick={async () => {
      if (busy.current) return;
      const attempt = ++scope.attempt.current; busy.current = true; setPending(true); setStatus(null);
      try { await privateFeedbackGet(`/companies/${companyId}/feedback-inbox/${item.id}/run-log-source`, scope.controller.current.signal); if (scope.current(attempt)) setStatus("sourceVerified"); }
      catch { if (scope.current(attempt)) setStatus("sourceUnavailable"); }
      finally { if (scope.current(attempt)) { busy.current = false; setPending(false); } }
    }}>{t("feedbackRunLogUi.verifySource")}</Button>{status && <p role="status">{t(`feedbackRunLogUi.${status}`)}</p>}
  </div>;
}
