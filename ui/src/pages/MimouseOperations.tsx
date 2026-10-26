import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createOperationPreviewSchema, type CreateOperationPreviewInput, type OperationPreview, type OperationPreviewRecord, type OperationReadiness, type RequestOperationApprovalInput } from "@paperclipai/shared";
import { api } from "@/api/client";
import { authApi } from "@/api/auth";
import { queryKeys } from "@/lib/queryKeys";
import { useCompany } from "@/context/CompanyContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { formatNumber, useTranslation } from "@/i18n";
import { Link, useSearchParams } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
type Summary = Omit<OperationPreviewRecord, "preview" | "requestId"> & Pick<OperationPreview, "period" | "timeZone" | "counts" | "previewHash">;
type Page = { items: Summary[]; nextBeforeId: string | null };
const areaClass = "min-h-32 w-full rounded-md border border-border bg-background p-3 font-mono text-xs";
function useActive() { const active = useRef(true); useEffect(() => { active.current = true; return () => { active.current = false; }; }, []); return active; }
function freshDraft() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit" }).formatToParts(new Date());
  return { requestId: crypto.randomUUID() as string, period: `${parts.find(p => p.type === "year")!.value}-${parts.find(p => p.type === "month")!.value}`, timeZone: "Asia/Shanghai", sourceInstance: "manual-import", targetInstance: "not-connected", mapping: '[{"sourceField":"amount","targetField":"amount"}]', sourceRecords: "[]", targetRecords: "[]" };
}
export function MimouseOperations() {
  const { t } = useTranslation(), { selectedCompanyId } = useCompany(), { setBreadcrumbs } = useBreadcrumbs();
  const session = useQuery({ queryKey: queryKeys.auth.session, queryFn: () => authApi.getSession(), retry: false });
  useEffect(() => { setBreadcrumbs([{ label: t("operationsUi.pageTitle") }]); }, [setBreadcrumbs, t]);
  if (!selectedCompanyId) return <p>{t("feedbackUi.chooseCompany")}</p>;
  if (session.isPending) return <p>{t("common.loading")}</p>;
  if (session.isError) return <p role="alert">{t("operationsUi.readError")}</p>;
  const userId = session.data?.user?.id ?? session.data?.session?.userId ?? "local-board";
  return <OperationsCompany key={`${selectedCompanyId}:${userId}`} companyId={selectedCompanyId} userId={userId} />;
}
function OperationsCompany({ companyId, userId }: { companyId: string; userId: string }) {
  const { t } = useTranslation(), client = useQueryClient(), active = useActive(), [search, setSearch] = useSearchParams();
  const fromUrl = search.get("preview"), [selected, setSelected] = useState<string | null>(null), [beforeId, setBeforeId] = useState<string>();
  const [draft, setDraft] = useState(freshDraft), [notice, setNotice] = useState(""), [localError, setLocalError] = useState(false);
  useEffect(() => { setSelected(fromUrl && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(fromUrl) ? fromUrl : null); }, [fromUrl]);
  const root = `/companies/${companyId}/data-operations`, key = ["mimouse-operations", companyId, userId];
  const list = useQuery({ queryKey: [...key, "list", beforeId], queryFn: () => api.get<Page>(`${root}${beforeId ? `?beforeId=${encodeURIComponent(beforeId)}` : ""}`), retry: false });
  function choose(id: string | null) { setSelected(id); setSearch(current => { const next = new URLSearchParams(current); if (id) next.set("preview", id); else next.delete("preview"); return next; }, { replace: true }); }
  function edit(next: typeof draft) { setDraft(next); setNotice(""); setLocalError(false); if (selected) choose(null); }
  const mutation = useMutation({ mutationFn: (payload: CreateOperationPreviewInput) => api.post<{ item: OperationPreviewRecord; duplicate: boolean }>(root, payload),
    onSuccess: result => { void client.invalidateQueries({ queryKey: key }); if (!active.current) return; choose(result.item.id); setNotice(result.duplicate ? "duplicate" : "created"); },
    onError: () => { void client.invalidateQueries({ queryKey: key }); } });
  if (list.isPending) return <p>{t("common.loading")}</p>;
  if (list.isError) return <div className="space-y-2"><p role="alert">{t("operationsUi.readError")}</p><Button variant="outline" onClick={() => { void list.refetch(); }}>{t("operationsUi.retryRead")}</Button></div>;
  return <div className="space-y-6">
    <p className="text-sm text-muted-foreground">{t("operationsUi.boundary")}</p>
    <form className="space-y-3 rounded-lg border border-border p-4" onSubmit={event => {
      event.preventDefault(); if (mutation.isPending) return; setLocalError(false); setNotice("");
      try { new Intl.DateTimeFormat("en", { timeZone: draft.timeZone }); const parsed = createOperationPreviewSchema.safeParse({ ...draft, mapping: JSON.parse(draft.mapping), sourceRecords: JSON.parse(draft.sourceRecords), targetRecords: JSON.parse(draft.targetRecords) });
        if (!parsed.success) { setLocalError(true); return; } mutation.mutate(parsed.data);
      } catch { setLocalError(true); }
    }}>
      <h2 className="font-medium">{t("operationsUi.createTitle")}</h2>
      <fieldset disabled={mutation.isPending} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">{(["period", "timeZone", "sourceInstance", "targetInstance"] as const).map(field => <label key={field} className="block space-y-1"><span>{t(`operationsUi.${field}`)}</span><Input type={field === "period" ? "month" : "text"} required maxLength={field === "period" ? 7 : 160} value={draft[field]} onChange={event => edit({ ...draft, [field]: event.target.value })} /></label>)}</div>
        {(["mapping", "sourceRecords", "targetRecords"] as const).map(field => <label key={field} className="block space-y-1"><span>{t(`operationsUi.${field}`)}</span><textarea className={areaClass} maxLength={1_000_000} required value={draft[field]} onChange={event => edit({ ...draft, [field]: event.target.value })} /></label>)}
        <p className="text-xs text-muted-foreground">{t("operationsUi.inputRules")}</p>
        <p className="break-all font-mono text-xs">{t("operationsUi.requestId")}: {draft.requestId}</p>
        <div className="flex flex-wrap gap-2"><Button type="submit">{t("operationsUi.preview")}</Button><Button type="button" variant="outline" onClick={() => { edit({ ...draft, requestId: crypto.randomUUID() }); mutation.reset(); }}>{t("operationsUi.newRequest")}</Button><Button type="button" variant="outline" onClick={() => {
          edit({ ...draft, requestId: crypto.randomUUID(), sourceInstance: "fixture-import", targetInstance: "not-connected",
            mapping: JSON.stringify([{ sourceField: "amount", targetField: "amount" }], null, 2),
            sourceRecords: JSON.stringify([{ sourceId: "example-event", targetId: "example-row", occurredAt: `${draft.period}-15T12:00:00Z`, values: { amount: "123.40" } }], null, 2),
            targetRecords: JSON.stringify([{ targetId: "example-row", version: "declared-only", values: { amount: "100.00" } }], null, 2) }); mutation.reset();
        }}>{t("operationsUi.example")}</Button></div>
      </fieldset>
      {localError && <p role="alert">{t("operationsUi.invalidInput")}</p>}{mutation.isError && <p role="alert">{t("operationsUi.createError")}</p>}{notice && <p role="status">{t(`operationsUi.${notice}`)}</p>}
    </form>
    <section className="space-y-2" aria-label={t("operationsUi.saved")}><h2 className="font-medium">{t("operationsUi.saved")}</h2>
      {!list.data.items.length && <p>{t("operationsUi.empty")}</p>}
      {list.data.items.filter(item => item.companyId === companyId).map(item => <Button key={item.id} variant="outline" className="h-auto w-full justify-start whitespace-normal text-left" onClick={() => choose(item.id)}>{item.period} · {item.timeZone} · {t("operationsUi.changeCount", { amount: formatNumber(item.counts.insert + item.counts.update) })}</Button>)}
      <div className="flex gap-2">{beforeId && <Button variant="outline" onClick={() => setBeforeId(undefined)}>{t("feedbackUi.latest")}</Button>}{list.data.nextBeforeId && <Button variant="outline" onClick={() => setBeforeId(list.data.nextBeforeId!)}>{t("feedbackUi.older")}</Button>}</div>
    </section>
    {selected && <OperationDetail key={selected} companyId={companyId} userId={userId} id={selected} />}
  </div>;
}
function OperationDetail({ companyId, userId, id }: { companyId: string; userId: string; id: string }) {
  const { t, i18n } = useTranslation(), client = useQueryClient(), active = useActive();
  const root = `/companies/${companyId}/data-operations/${encodeURIComponent(id)}`, key = ["mimouse-operations", companyId, userId, id];
  const record = useQuery({ queryKey: [...key, "record"], queryFn: () => api.get<OperationPreviewRecord>(root), retry: false });
  const readiness = useQuery({ queryKey: [...key, "readiness"], queryFn: () => api.get<OperationReadiness>(`${root}/readiness`), retry: false });
  const [confirmed, setConfirmed] = useState(false), [visible, setVisible] = useState(20), [createdApproval, setCreatedApproval] = useState<string | null>(null);
  const review = useMutation({ mutationFn: (payload: RequestOperationApprovalInput) => api.post<{ approvalId: string; previewHash: string }>(`${root}/request-approval`, payload),
    onSuccess: result => { void client.invalidateQueries({ queryKey: key }); if (active.current && result.previewHash === record.data?.preview.previewHash) { setCreatedApproval(result.approvalId); setConfirmed(false); } },
    onError: () => { void client.invalidateQueries({ queryKey: key }); } });
  if (record.isPending) return <p>{t("common.loading")}</p>;
  if (record.isError || record.data.companyId !== companyId || record.data.id !== id || record.data.preview.companyId !== companyId || record.data.preview.mode !== "dry_run") return <div className="space-y-2"><p role="alert">{t("operationsUi.readError")}</p><Button variant="outline" onClick={() => { void record.refetch(); }}>{t("operationsUi.retryRead")}</Button></div>;
  const p = record.data.preview, approvalId = createdApproval ?? record.data.approvalId, allVisible = visible >= p.operations.length;
  return <section className="space-y-4 rounded-lg border border-border p-4" aria-label={t("operationsUi.detail")}>
    <h2 className="font-medium">{t("operationsUi.detail")}: {p.period} · {p.timeZone}</h2>
    <p className="text-sm text-muted-foreground">{t("operationsUi.importedSnapshot")}</p><p className="break-all font-mono text-xs">SHA-256: {p.previewHash}</p>
    <div className="flex flex-wrap gap-3">{(["insert", "update", "noop", "excluded"] as const).map(kind => <p key={kind}>{t(`operationsUi.${kind}`)}: {formatNumber(p.counts[kind])}</p>)}</div>
    {p.operations.slice(0, visible).map(operation => <div key={operation.key} className="space-y-2 rounded-md border border-border p-3">
      <h3 className="break-all text-sm font-medium">{t(`operationsUi.${operation.action}`)} · {operation.sourceId} → {operation.targetId}</h3>
      <div className="grid gap-3 sm:grid-cols-2">{(["before", "after"] as const).map(side => <div key={side} className="min-w-0"><p className="text-xs text-muted-foreground">{t(`operationsUi.${side}`)}</p><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all bg-muted p-2 text-xs">{JSON.stringify(operation[side], null, 2)}</pre></div>)}</div>
      <p className="break-all font-mono text-xs">{t("operationsUi.operationKey")}: {operation.key}</p>
    </div>)}
    {!allVisible && <Button variant="outline" onClick={() => setVisible(value => value + 20)}>{t("operationsUi.showMore", { shown: formatNumber(visible), total: formatNumber(p.operations.length) })}</Button>}
    {!!p.excluded.length && <details><summary>{t("operationsUi.excluded")}: {formatNumber(p.excluded.length)}</summary><div className="space-y-1 pt-2">{p.excluded.map(row => <p key={row.sourceId} className="break-all text-xs">{row.sourceId} · {row.occurredAt} → {row.observedPeriod}</p>)}</div></details>}
    <div className="space-y-2 border-t border-border pt-3"><p>{t("operationsUi.noWrites")}</p>
      {readiness.isPending ? <p>{t("common.loading")}</p> : readiness.isError ? <p role="alert">{t("operationsUi.readError")}</p> : <>{readiness.data.blockers.map(reason => <p key={reason} className="text-sm">{t(`operationsUi.${reason}`, { defaultValue: reason })}</p>)}{readiness.data.approval && <p>{t("operationsUi.reviewStatus")}: {t(`statuses.${readiness.data.approval.status}`, { defaultValue: readiness.data.approval.status })}</p>}</>}
      {approvalId ? <Link className="text-sm underline" to={`/approvals/${approvalId}`}>{t("operationsUi.openApproval")}</Link> : userId === "local-board" ? <p>{t("operationsUi.sessionRequired")}</p> : <>
        <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} disabled={!allVisible || review.isPending} onChange={event => setConfirmed(event.target.checked)} /><span>{t("operationsUi.reviewConfirm")}</span></label>
        <Button disabled={!confirmed || !allVisible || review.isPending || readiness.isPending || readiness.isError || p.counts.insert + p.counts.update === 0} onClick={() => review.mutate({ confirm: true, expectedPreviewHash: p.previewHash, locale: (["en", "zh-CN", "es", "ja"].includes(i18n.language) ? i18n.language : "en") as RequestOperationApprovalInput["locale"] })}>{t("operationsUi.requestReview")}</Button>
      </>}
      <Button variant="outline" onClick={() => { void readiness.refetch(); void record.refetch(); }}>{t("operationsUi.refreshReview")}</Button>
      {review.isError && <p role="alert">{t("operationsUi.reviewError")}</p>}
    </div>
  </section>;
}
