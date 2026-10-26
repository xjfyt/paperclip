import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FeedbackVerificationCheck, FeedbackVerificationConfirm, FeedbackVerificationHistory, FeedbackVerificationOptions, FeedbackVerificationPreview, FeedbackVerificationReceipt, FeedbackVerificationSelection, FeedbackVerificationSnapshot } from "@paperclipai/shared/mimouse-feedback-verification";
import { api } from "@/api/client";
import { privateFeedbackGet } from "@/api/private-feedback";
import { useTranslation } from "@/i18n";
import { Button } from "@/components/ui/button";
interface Props { companyId: string; userId: string; sessionId: string; id: string }
export function MimouseFeedbackVerification(props: Props) {
  return <Verification key={JSON.stringify([props.companyId, props.userId, props.sessionId, props.id])} {...props} />;
}
function Verification({ companyId, userId, sessionId, id }: Props) {
  const { t } = useTranslation(), client = useQueryClient();
  const active = useRef(true), submitting = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const root = `/companies/${companyId}/feedback-inbox/${id}`, key = ["feedback-verification", companyId, userId, sessionId, id];
  const ready = userId !== "local-board" && Boolean(sessionId);
  const options = useQuery({ queryKey: [...key, "options"], gcTime: 0, staleTime: 0, retry: false, enabled: ready,
    queryFn: ({ signal }) => privateFeedbackGet<FeedbackVerificationOptions>(`${root}/verification-options`, signal) });
  const history = useQuery({ queryKey: [...key, "history"], gcTime: 0, staleTime: 0, retry: false, enabled: ready,
    queryFn: ({ signal }) => privateFeedbackGet<FeedbackVerificationHistory>(`${root}/verifications`, signal) });
  const [selection, setSelection] = useState({ reproduction: "", regression: "" });
  const [preview, setPreview] = useState<FeedbackVerificationPreview | null>(null);
  const [confirmations, setConfirmations] = useState({ reproduction: false, fix: false, environment: false });
  const [attempt, setAttempt] = useState<FeedbackVerificationConfirm | null>(null);
  const readPreview = useMutation({ mutationFn: (value: FeedbackVerificationSelection) => api.post<FeedbackVerificationPreview>(`${root}/verification-preview`, value),
    onSuccess: result => { if (active.current) setPreview(result); } });
  const save = useMutation({ mutationFn: (value: FeedbackVerificationConfirm) => api.post<FeedbackVerificationReceipt>(`${root}/verifications`, value),
    onSuccess: () => { if (active.current) { setAttempt(null); setPreview(null); setConfirmations({ reproduction: false, fix: false, environment: false }); } },
    onSettled: () => { submitting.current = false; void client.invalidateQueries({ queryKey: [...key, "history"] }); } });
  useEffect(() => { if (options.isFetching || history.isFetching || options.isError || history.isError) { setPreview(null); setConfirmations({ reproduction: false, fix: false, environment: false }); } }, [options.isFetching, history.isFetching, options.isError, history.isError]);
  function change(kind: "reproduction" | "regression", value: string) {
    setSelection(current => ({ ...current, [kind]: value })); setPreview(null); setConfirmations({ reproduction: false, fix: false, environment: false }); readPreview.reset();
  }
  function parsed(): FeedbackVerificationSelection {
    const parse = (value: string) => { const [deliveryId, index] = value.split(":"); return { deliveryId, checkIndex: Number(index) }; };
    return { reproduction: parse(selection.reproduction), regression: parse(selection.regression) };
  }
  function sourceSummary(snapshot: FeedbackVerificationSnapshot) {
    return <div className="space-y-1 break-all font-mono text-xs">
      <p>{snapshot.feedbackId} · {snapshot.source.sourceKind} · {snapshot.source.sourceInstance} · {snapshot.source.externalId}</p>
      <p>{t("feedbackUi.product")}: {snapshot.source.product} · {t("feedbackUi.softwareVersion")}: {snapshot.source.softwareVersion}</p>
      <p>{t("feedbackUi.traceId")}: {snapshot.source.traceId ?? "—"}</p>
    </div>;
  }
  function checkSummary(check: FeedbackVerificationCheck) {
    return <div className="space-y-1 break-all font-mono text-xs">
      <p>{t("feedbackVerification.delivery")}: {check.deliveryId} · {t("feedbackVerification.check")}: {check.checkIndex}</p>
      <p>{t("feedbackVerification.commit")}: {check.commitSha}</p><p>{t("feedbackVerification.time")}: {check.startedAt} → {check.finishedAt}</p>
      <p>{t("feedbackVerification.exitCode")}: {check.exitCode}</p><p>{t("feedbackVerification.commandDigest")}: {check.commandDigest}</p>
      <p>{t("feedbackVerification.logDigest")}: {check.logRefDigest}</p>
    </div>;
  }
  if (!ready) return <p>{t("feedbackUi.sessionRequired")}</p>;
  if (options.isPending || history.isPending || options.isFetching || history.isFetching) return <p>{t("common.loading")}</p>;
  if (options.isError || history.isError) return <p role="alert">{t("feedbackVerification.readError")}</p>;
  return <section className="space-y-3 border-t border-border pt-4">
    <h3 className="font-medium">{t("feedbackVerification.title")}</h3>
    <p className="text-sm text-muted-foreground">{t("feedbackVerification.boundary")}</p>
    <p className="text-sm">{t("feedbackVerification.requirements")}</p>
    {(options.data.hasMore || history.data.hasMore) && <p>{t("feedbackVerification.limited")}</p>}
    <fieldset disabled={readPreview.isPending || save.isPending || attempt !== null} className="space-y-3">
      {(["reproduction", "regression"] as const).map(kind => <label key={kind} className="block space-y-1">
        <span>{t(`feedbackVerification.${kind}`)}</span><select className="w-full rounded-md border border-border bg-background p-2 text-sm" value={selection[kind]} onChange={event => change(kind, event.target.value)}>
          <option value="">{t("feedbackVerification.select")}</option>
          {options.data.checks.filter(check => check.status === (kind === "reproduction" ? "failed" : "passed")).map(check => <option key={`${check.deliveryId}:${check.checkIndex}`} value={`${check.deliveryId}:${check.checkIndex}`}>{check.commitSha} · {check.deliveryId} · #{check.checkIndex}</option>)}
        </select>
      </label>)}
      <Button type="button" variant="outline" disabled={!selection.reproduction || !selection.regression} onClick={() => { setPreview(null); readPreview.mutate(parsed()); }}>{t("feedbackVerification.preview")}</Button>
    </fieldset>
    {readPreview.isError && <p role="alert">{t("feedbackVerification.previewError")}</p>}
    {preview && <div className="space-y-3">
      <p className="text-sm">{t("feedbackVerification.awaiting")}</p>{sourceSummary(preview.snapshot)}
      <h4>{t("feedbackVerification.reproduction")}</h4>{checkSummary(preview.snapshot.reproduction)}
      <h4>{t("feedbackVerification.regression")}</h4>{checkSummary(preview.snapshot.regression)}
      <fieldset disabled={save.isPending || attempt !== null} className="space-y-2">
        {(["reproduction", "fix", "environment"] as const).map(kind => <label key={kind} className="flex items-start gap-2"><input type="checkbox" checked={confirmations[kind]} onChange={event => setConfirmations(current => ({ ...current, [kind]: event.target.checked }))} /><span>{t(`feedbackVerification.confirm_${kind}`)}</span></label>)}
      </fieldset>
    </div>}
    {(preview || attempt) && <div className="flex items-center justify-between gap-2">
      <Button type="button" variant="outline" disabled={save.isPending} onClick={() => { setAttempt(null); setPreview(null); setConfirmations({ reproduction: false, fix: false, environment: false }); save.reset(); }}>{t("feedbackVerification.cancel")}</Button>
      <Button type="button" disabled={save.isPending || (!attempt && (!preview || !Object.values(confirmations).every(Boolean)))} onClick={() => {
        if (submitting.current) return;
        const payload = attempt ?? { ...parsed(), requestId: crypto.randomUUID(), previewDigest: preview!.previewDigest, confirmReproduction: true, confirmFix: true, confirmComparableEnvironment: true } as FeedbackVerificationConfirm;
        submitting.current = true; setAttempt(payload); save.mutate(payload);
      }}>{t(attempt ? "feedbackVerification.retry" : "feedbackVerification.record")}</Button>
    </div>}
    {save.isError && <p role="alert">{t("feedbackVerification.saveError")}</p>}
    <h4 className="font-medium">{t("feedbackVerification.history")}</h4>
    {!history.data.items.length && <p>{t("feedbackVerification.empty")}</p>}
    {history.data.items.map(item => <details key={item.id} className="space-y-2 rounded-md border border-border p-3"><summary>{t("feedbackVerification.attested")} · {item.createdAt}</summary>
      <p className="text-sm">{t("feedbackVerification.historical")}</p>{sourceSummary(item.snapshot)}<p className="break-all font-mono text-xs">{item.id} · {item.actorUserId}</p>
      <h4>{t("feedbackVerification.reproduction")}</h4>{checkSummary(item.snapshot.reproduction)}<h4>{t("feedbackVerification.regression")}</h4>{checkSummary(item.snapshot.regression)}
    </details>)}
  </section>;
}
