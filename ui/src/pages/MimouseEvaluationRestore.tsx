import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { EvaluationComparisonRecord } from "@paperclipai/shared/mimouse-evaluation";
import type { EvaluationRestoreReceipt } from "@paperclipai/shared/mimouse-evaluation-restore";
import { api } from "@/api/client";
import { useTranslation } from "@/i18n";
import { Button } from "@/components/ui/button";
type Readiness = { blockers: string[]; currentVersionId: string | null; pendingOperationId: string | null; lastRestoreId: string | null; sourceType: string; sourceKind: string | null };
export function MimouseEvaluationRestore({ companyId, userId, comparison }: { companyId: string; userId: string; comparison: EvaluationComparisonRecord }) {
  const { t } = useTranslation(), client = useQueryClient(), active = useRef(true), root = `/companies/${companyId}/skill-evaluations/restores`, key = ["evaluation-restores", companyId, userId];
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const [action, setAction] = useState<"activate" | "rollback">("activate"), [confirmed, setConfirmed] = useState(false), [recoverConfirmed, setRecoverConfirmed] = useState(false);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID()), [result, setResult] = useState<EvaluationRestoreReceipt | null>(null);
  const readiness = useQuery({ queryKey: [...key, "readiness", comparison.id], queryFn: () => api.get<Readiness>(`${root}/readiness/${comparison.id}`), retry: false });
  const history = useQuery({ queryKey: [...key, "history"], queryFn: () => api.get<EvaluationRestoreReceipt[]>(root), retry: false });
  const referenceId = readiness.data?.pendingOperationId ?? readiness.data?.lastRestoreId;
  const reference = useQuery({ queryKey: [...key, "reference", referenceId], queryFn: () => api.get<EvaluationRestoreReceipt>(`${root}/${referenceId}`), enabled: Boolean(referenceId), retry: false });
  function refreshed(item: EvaluationRestoreReceipt) { void client.invalidateQueries({ queryKey: key }); if (!active.current) return; setConfirmed(false); setRecoverConfirmed(false); setResult(item); }
  const create = useMutation({ mutationFn: (body: unknown) => api.post<{ item: EvaluationRestoreReceipt }>(root, body), onSuccess: value => refreshed(value.item) });
  const recover = useMutation({ mutationFn: ({ item, resolution }: { item: EvaluationRestoreReceipt; resolution: "apply" | "compensate" }) => api.post<EvaluationRestoreReceipt>(`${root}/${item.id}/recover`, { expectedOperationHash: item.operationHash, resolution, confirm: true }), onSuccess: refreshed });
  const busy = create.isPending || recover.isPending;
  if (readiness.isPending || history.isPending) return <p>{t("common.loading")}</p>;
  if (readiness.isError || history.isError) return <section className="space-y-2"><p role="alert">{t("evaluationRestoreUi.sessionRequired")}</p><Button variant="outline" onClick={() => { void readiness.refetch(); void history.refetch(); }}>{t("evaluationRestoreUi.refresh")}</Button></section>;
  const items = [...(reference.data ? [reference.data] : []), ...(result ? [result] : []), ...history.data].filter((item, index, all) => item.companyId === companyId && item.reportId === comparison.id && all.findIndex(other => other.id === item.id) === index);
  const pending = items.find(item => item.id === readiness.data.pendingOperationId && item.status === "prepared");
  const activation = items.find(item => item.id === readiness.data.lastRestoreId && item.action === "activate" && item.status === "applied");
  const beforeVersion = action === "activate" ? comparison.report.baseline.versionId : comparison.report.candidate.versionId;
  const targetVersion = action === "activate" ? comparison.report.candidate.versionId : comparison.report.baseline.versionId;
  const canCreate = readiness.data.blockers.length === 0 && readiness.data.currentVersionId === beforeVersion && (action === "activate" || Boolean(activation));
  return <section className="space-y-3 border-t border-border pt-4">
    <h3 className="font-medium">{t("evaluationRestoreUi.title")}</h3>
    <p className="text-sm text-muted-foreground">{t("evaluationRestoreUi.boundary")}</p>
    <p className="text-xs">{t("evaluationRestoreUi.source")}: {readiness.data.sourceType} · {readiness.data.sourceKind ?? "—"}</p>
    <ul>{readiness.data.blockers.map(blocker => <li key={blocker}>{t(`evaluationRestoreUi.${blocker}`)}</li>)}</ul>
    {(reference.isError || create.isError || recover.isError) && <p role="alert">{t("evaluationRestoreUi.error")}</p>}
    <fieldset disabled={busy} className="space-y-2">
      <label className="block space-y-1"><span>{t("evaluationRestoreUi.action")}</span><select className="rounded-md border border-border bg-background p-2" value={action} onChange={event => { setAction(event.target.value as "activate" | "rollback"); setConfirmed(false); setRequestId(crypto.randomUUID()); create.reset(); }}><option value="activate">{t("evaluationRestoreUi.activate")}</option><option value="rollback">{t("evaluationRestoreUi.rollback")}</option></select></label>
      <p className="break-all font-mono text-xs">{t("evaluationRestoreUi.before")}: {beforeVersion}<br />{t("evaluationRestoreUi.target")}: {targetVersion}<br />{t("evaluationRestoreUi.reportHash")}: {comparison.report.reportHash}</p>
      <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} disabled={!canCreate} onChange={event => setConfirmed(event.target.checked)} /><span>{t("evaluationRestoreUi.confirm")}</span></label>
      <div className="flex flex-wrap gap-2"><Button disabled={!confirmed || !canCreate} onClick={() => create.mutate({ requestId, reportId: comparison.id, expectedReportHash: comparison.report.reportHash, expectedCurrentVersionId: beforeVersion, action, ...(action === "rollback" ? { rollbackOf: activation!.id } : {}), confirm: true })}>{t(`evaluationRestoreUi.${action}`)}</Button><Button variant="outline" onClick={() => { setRequestId(crypto.randomUUID()); setConfirmed(false); create.reset(); }}>{t("evaluationRestoreUi.newRequest")}</Button><Button variant="outline" onClick={() => { void client.invalidateQueries({ queryKey: key }); }}>{t("evaluationRestoreUi.refresh")}</Button></div>
    </fieldset>
    {!canCreate && !readiness.data.blockers.length && <p>{t("evaluationRestoreUi.versionOrReceiptMismatch")}</p>}
    {pending && <div className="space-y-2 rounded-md border border-border p-3">
      <h4 className="font-medium">{t("evaluationRestoreUi.recoveryRequired")}</h4><p>{t("evaluationRestoreUi.recoveryBoundary")}</p>
      <p className="break-all font-mono text-xs">{pending.id}<br />{pending.operationHash}<br />{pending.beforeHash} → {pending.targetHash}</p>
      {pending.errorCode && <p role="alert">{t("evaluationRestoreUi.recoveryError")}: {pending.errorCode}</p>}
      <label className="flex items-start gap-2"><input type="checkbox" disabled={busy} checked={recoverConfirmed} onChange={event => setRecoverConfirmed(event.target.checked)} /><span>{t("evaluationRestoreUi.recoveryConfirm")}</span></label>
      <div className="flex flex-wrap gap-2"><Button disabled={busy || !recoverConfirmed || pending.resolution === "compensate"} onClick={() => recover.mutate({ item: pending, resolution: "apply" })}>{t("evaluationRestoreUi.finish")}</Button><Button variant="outline" disabled={busy || !recoverConfirmed} onClick={() => recover.mutate({ item: pending, resolution: "compensate" })}>{t("evaluationRestoreUi.compensate")}</Button></div>
    </div>}
    {result && <p role="status">{t(`evaluationRestoreUi.${result.status}`)}</p>}
    <details><summary>{t("evaluationRestoreUi.history")}</summary>{items.map(item => <div key={item.id} className="space-y-1 py-2"><p>{t(`evaluationRestoreUi.${item.action}`)} · {t(`evaluationRestoreUi.${item.status}`)}</p><p className="break-all font-mono text-xs">{item.id}<br />{item.operationHash}<br />{item.beforeHash} → {item.targetHash}</p></div>)}</details>
  </section>;
}
