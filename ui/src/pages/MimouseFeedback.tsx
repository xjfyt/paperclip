import { MimouseFeedbackRunLog, MimouseFeedbackRunLogSource, isRunLogCandidate } from "@/components/MimouseFeedbackRunLog";
import { MimouseFeedbackVerification } from "@/components/MimouseFeedbackVerification";
import { MimouseFeedbackEvidence } from "@/components/MimouseFeedbackEvidence";
import { MimouseWecomPanel } from "@/components/MimouseWecomPanel";
import { MimouseLangfusePanel } from "@/components/MimouseLangfusePanel";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FeedbackImportInput, FeedbackInboxItem, FeedbackInboxPage, FeedbackPromotionInput, FeedbackPromotionReceipt } from "@paperclipai/shared";
import { api } from "@/api/client";
import { privateFeedbackGet } from "@/api/private-feedback";
import { authApi } from "@/api/auth";
import { queryKeys } from "@/lib/queryKeys";
import { useCompany } from "@/context/CompanyContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useTranslation } from "@/i18n";
import { Link } from "@/lib/router";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
type PromotionStatus = { recorded: boolean; receipt: FeedbackPromotionReceipt | null };
const textAreaClass = "min-h-24 w-full rounded-md border border-border bg-background p-3 text-sm";
function useActive() { const active = useRef(true); useLayoutEffect(() => { active.current = true; return () => { active.current = false; }; }, []); return active; }
function blankImport() { return { sourceKind: "manual" as FeedbackImportInput["sourceKind"], sourceInstance: "manual-ui", externalId: crypto.randomUUID() as string, title: "", text: "", product: "", softwareVersion: "", commitSha: "", traceId: "", occurredAt: new Date().toISOString() }; }
export function MimouseFeedback() {
  const { t } = useTranslation(), { setBreadcrumbs } = useBreadcrumbs(), { selectedCompanyId } = useCompany();
  const session = useQuery({ queryKey: queryKeys.auth.session, queryFn: () => authApi.getSession(), retry: false });
  useEffect(() => { setBreadcrumbs([{ label: t("feedbackUi.pageTitle") }]); }, [setBreadcrumbs, t]);
  if (!selectedCompanyId) return <p>{t("feedbackUi.chooseCompany")}</p>;
  if (session.isPending || session.isFetching) return <p>{t("common.loading")}</p>;
  if (session.isError) return <p role="alert">{t("feedbackUi.readError")}</p>;
  const userId = session.data?.user?.id ?? session.data?.session?.userId ?? "local-board";
  const sessionId = session.data?.session?.id ?? "";
  return <FeedbackCompany key={JSON.stringify([selectedCompanyId, userId, sessionId])} companyId={selectedCompanyId} userId={userId} sessionId={sessionId} privateSessionReady={!session.isFetching} />;
}
function FeedbackCompany({ companyId, userId, sessionId, privateSessionReady }: { companyId: string; userId: string; sessionId: string; privateSessionReady: boolean }) {
  const { t } = useTranslation(), client = useQueryClient(), active = useActive();
  const [beforeId, setBeforeId] = useState<string>(), [selectedId, setSelectedId] = useState<string | null>(null), [form, setFormDraft] = useState(blankImport), [notice, setNotice] = useState("");
  const importAttempt = useRef(0), importBusy = useRef(false);
  function setForm(value: ReturnType<typeof blankImport>) { importAttempt.current++; setFormDraft(value); setNotice(""); }
  const root = `/companies/${companyId}/feedback-inbox`, key = ["mimouse-feedback", companyId, userId, sessionId];
  const query = useQuery({ queryKey: [...key, "list", beforeId], gcTime: 0, staleTime: 0, queryFn: ({ signal }) => privateFeedbackGet<FeedbackInboxPage>(`${root}${beforeId ? `?beforeId=${encodeURIComponent(beforeId)}` : ""}`, signal), retry: false });
  const mutation = useMutation({ mutationFn: ({ input }: { input: FeedbackImportInput; attempt: number }) => api.post<{ item: FeedbackInboxItem; duplicate: boolean }>(root, input),
    onSuccess: (result, variables) => { if (!active.current || variables.attempt !== importAttempt.current) return; void client.invalidateQueries({ queryKey: key }); setSelectedId(result.item.id); setNotice(result.duplicate ? "duplicate" : "imported"); },
    onSettled: () => { importBusy.current = false; } });
  if (query.isPending || query.isFetching) return <p>{t("common.loading")}</p>;
  if (query.isError) return <p role="alert">{t("feedbackUi.readError")}</p>;
  const fields = ["sourceInstance", "externalId", "title", "product", "softwareVersion", "commitSha", "traceId", "occurredAt"] as const;
  const maxLengths = { sourceInstance: 160, externalId: 160, title: 240, product: 120, softwareVersion: 120, commitSha: 40, traceId: 160, occurredAt: 40 };
  return <div className="space-y-6">
    <p className="text-sm text-muted-foreground">{t("feedbackUi.boundary")}</p>
    <details className="rounded-lg border border-border p-4"><summary className="cursor-pointer font-medium">{t("langfuseUi.title")}</summary><div className="pt-4"><MimouseLangfusePanel companyId={companyId} onImported={() => { void client.invalidateQueries({ queryKey: key }); }} /></div></details>
    <details className="rounded-lg border border-border p-4"><summary className="cursor-pointer font-medium">{t("wecomUi.title")}</summary><div className="pt-4"><MimouseWecomPanel companyId={companyId} userId={userId} sessionId={privateSessionReady ? sessionId : ""} /></div></details>
    <MimouseFeedbackRunLog companyId={companyId} userId={userId} sessionId={sessionId} onImported={result => { if (!active.current) return; setSelectedId(result.item.id); setNotice(result.duplicate ? "duplicate" : "imported"); void client.invalidateQueries({ queryKey: key }); }} />
    <form className="space-y-3 rounded-lg border border-border p-4" onSubmit={event => { event.preventDefault(); if (importBusy.current) return; importBusy.current = true; setNotice(""); mutation.mutate({ input: { ...form, commitSha: form.commitSha || null, traceId: form.traceId || null }, attempt: ++importAttempt.current }); }}>
      <h2 className="font-medium">{t("feedbackUi.importTitle")}</h2>
      <fieldset disabled={mutation.isPending} className="space-y-3">
        <label className="block space-y-1"><span>{t("feedbackUi.sourceKind")}</span><select className="w-full rounded-md border border-border bg-background p-2 text-sm" value={form.sourceKind} onChange={event => setForm({ ...form, sourceKind: event.target.value as FeedbackImportInput["sourceKind"] })}>{["manual", "application_log", "langfuse", "wecom_smart_bot"].map(value => <option key={value} value={value}>{t(`feedbackUi.source_${value}`)}</option>)}</select></label>
        <div className="grid gap-3 sm:grid-cols-2">{fields.map(field => <label key={field} className="block space-y-1"><span>{t(`feedbackUi.${field}`)}</span><Input value={form[field]} maxLength={maxLengths[field]} required={["sourceInstance", "externalId", "title", "product", "occurredAt"].includes(field)} onChange={event => setForm({ ...form, [field]: event.target.value })} /></label>)}</div>
        <label className="block space-y-1"><span>{t("feedbackUi.text")}</span><textarea className={textAreaClass} required maxLength={32000} value={form.text} onChange={event => setForm({ ...form, text: event.target.value })} /></label>
        <p className="text-xs text-muted-foreground">{t("feedbackUi.redactionWarning")}</p>
        <div className="flex flex-wrap gap-2"><Button type="submit">{t("feedbackUi.import")}</Button><Button type="button" variant="outline" onClick={() => { setForm(blankImport()); setNotice(""); mutation.reset(); }}>{t("feedbackUi.newImport")}</Button></div>
      </fieldset>
      {mutation.isError && <p role="alert">{t("feedbackUi.writeError")}</p>}{notice && <p role="status">{t(`feedbackUi.${notice}`)}</p>}
    </form>
    <section className="space-y-3" aria-label={t("feedbackUi.records")}>
      <h2 className="font-medium">{t("feedbackUi.records")}</h2>
      {!query.data.items.length && <p>{t("feedbackUi.empty")}</p>}
      <div className="space-y-2">{query.data.items.map(item => <Button key={item.id} variant="outline" className="h-auto w-full justify-start whitespace-normal text-left" onClick={() => setSelectedId(item.id)}>{isRunLogCandidate(item) ? t("feedbackRunLogUi.title") : item.title} · {item.product} · {item.softwareVersion}</Button>)}</div>
      <div className="flex gap-2">{beforeId && <Button variant="outline" onClick={() => setBeforeId(undefined)}>{t("feedbackUi.latest")}</Button>}{query.data.nextBeforeId && <Button variant="outline" onClick={() => setBeforeId(query.data.nextBeforeId!)}>{t("feedbackUi.older")}</Button>}</div>
    </section>
    {selectedId && <FeedbackDetail key={selectedId} companyId={companyId} userId={userId} sessionId={sessionId} id={selectedId} onSelect={setSelectedId} />}
  </div>;
}
function FeedbackDetail({ companyId, userId, sessionId, id, onSelect }: { companyId: string; userId: string; sessionId: string; id: string; onSelect: (id: string) => void }) {
  const { t } = useTranslation(), root = `/companies/${companyId}/feedback-inbox/${id}`, key = ["mimouse-feedback", companyId, userId, sessionId, id];
  const source = useQuery({ queryKey: [...key, "item"], gcTime: 0, staleTime: 0, queryFn: ({ signal }) => privateFeedbackGet<FeedbackInboxItem>(root, signal), retry: false });
  const candidates = useQuery({ queryKey: [...key, "candidates"], gcTime: 0, staleTime: 0, queryFn: ({ signal }) => privateFeedbackGet<{ items: FeedbackInboxItem[]; hasMore: boolean; autoMerged: false }>(`${root}/candidates`, signal), retry: false });
  if (source.isPending || source.isFetching) return <p>{t("common.loading")}</p>;
  if (source.isError) return <p role="alert">{t("feedbackUi.readError")}</p>;
  return <section className="space-y-4 rounded-lg border border-border p-4">
    <h2 className="font-medium">{isRunLogCandidate(source.data) ? t("feedbackRunLogUi.title") : source.data.title}</h2><p className="break-all font-mono text-xs">{source.data.id}</p>
    <p className="text-sm">{t(source.data.ingestionMode === "provider_fetch" ? "feedbackUi.providerFetched" : source.data.ingestionMode === "provider_push" ? "feedbackUi.providerPushed" : "feedbackUi.manualOnly")}</p>
    {source.data.sourceUrl && <p className="break-all text-xs">{t("feedbackUi.sourceUrl")}: {source.data.sourceUrl}</p>}
    {isRunLogCandidate(source.data) ? <MimouseFeedbackRunLogSource companyId={companyId} userId={userId} sessionId={sessionId} item={source.data} /> : <pre className="whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-sm">{source.data.text}</pre>}
    <h3 className="font-medium">{t("feedbackUi.candidates")}</h3><p className="text-xs text-muted-foreground">{t("feedbackUi.candidateBoundary")}</p>
    {candidates.isPending || candidates.isFetching ? <p>{t("common.loading")}</p> : candidates.isError ? <p role="alert">{t("feedbackUi.readError")}</p> : candidates.data.items.length ? candidates.data.items.map(item => <Button key={item.id} variant="outline" className="h-auto whitespace-normal" onClick={() => onSelect(item.id)}>{item.title} · {item.sourceInstance}</Button>) : <p>{t("feedbackUi.noCandidates")}</p>}
    {!candidates.isError && !candidates.isFetching && candidates.data?.hasMore && <p>{t("feedbackUi.moreCandidates")}</p>}
    <MimouseFeedbackEvidence key={id} companyId={companyId} userId={userId} sessionId={sessionId} id={id} onSelect={onSelect} />
    <FeedbackReview companyId={companyId} userId={userId} sessionId={sessionId} item={source.data} />
  </section>;
}
function FeedbackReview({ companyId, userId, sessionId, item }: { companyId: string; userId: string; sessionId: string; item: FeedbackInboxItem }) {
  const { t } = useTranslation(), active = useActive(), client = useQueryClient();
  const root = `/companies/${companyId}/feedback-inbox/${item.id}`, key = ["mimouse-feedback", companyId, userId, sessionId, item.id, "promotion"];
  const status = useQuery({ queryKey: key, gcTime: 0, staleTime: 0, queryFn: ({ signal }) => privateFeedbackGet<PromotionStatus>(`${root}/promotion`, signal), enabled: userId !== "local-board", retry: false });
  const [draft, setDraft] = useState({ title: item.title, reproduction: "", expectedBehavior: "", fixProposal: "", acceptanceCriteria: "" });
  const [confirmed, setConfirmed] = useState(false), [attempt, setAttempt] = useState<FeedbackPromotionInput | null>(null), [receipt, setReceipt] = useState<FeedbackPromotionReceipt | null>(null);
  const mutation = useMutation({ mutationFn: (payload: FeedbackPromotionInput) => api.post<FeedbackPromotionReceipt>(`${root}/promote`, payload),
    onSuccess: result => { void client.invalidateQueries({ queryKey: key }); if (active.current) setReceipt(result); },
    onError: () => { void client.invalidateQueries({ queryKey: key }); } });
  useEffect(() => { if (status.isFetching || status.isError) setConfirmed(false); if (status.isError) setReceipt(null); }, [status.isFetching, status.isError]);
  if (userId === "local-board") return <p>{t("feedbackUi.sessionRequired")}</p>;
  if (status.isError) return <p role="alert">{t("feedbackUi.readError")}</p>;
  if (status.isPending || status.isFetching) return <p>{t("common.loading")}</p>;
  const recorded = receipt ?? status.data?.receipt;
  if (recorded) return <div className="space-y-2"><p role="status">{t("feedbackUi.confirmed")}</p><Link className="text-sm underline" to={`/issues/${recorded.issueId}`}>{t("feedbackUi.openTask")}</Link><p className="break-all font-mono text-xs">{recorded.requestId}</p><MimouseFeedbackVerification companyId={companyId} userId={userId} sessionId={sessionId} id={item.id} /></div>;
  if (status.data.recorded) return <div className="space-y-2"><p>{t("feedbackUi.alreadyConfirmed")}</p><MimouseFeedbackVerification companyId={companyId} userId={userId} sessionId={sessionId} id={item.id} /></div>;
  return <form className="space-y-3 border-t border-border pt-4" onSubmit={event => {
    event.preventDefault(); if (mutation.isPending) return;
    if (attempt) { mutation.mutate(attempt); return; }
    if (!confirmed) return;
    const payload: FeedbackPromotionInput = { ...draft, requestId: crypto.randomUUID(), confirm: true, acceptanceCriteria: draft.acceptanceCriteria.split("\n").map(value => value.trim()).filter(Boolean) };
    setAttempt(payload); mutation.mutate(payload);
  }}>
    <h3 className="font-medium">{t("feedbackUi.reviewTitle")}</h3><p className="text-sm text-muted-foreground">{t("feedbackUi.reviewBoundary")}</p>
    <fieldset disabled={mutation.isPending || attempt !== null} className="space-y-3">
      {(["title", "reproduction", "expectedBehavior", "fixProposal", "acceptanceCriteria"] as const).map(field => <label className="block space-y-1" key={field}><span>{t(`feedbackUi.${field}`)}</span>{field === "title" ? <Input required maxLength={240} value={draft[field]} onChange={event => { setDraft({ ...draft, [field]: event.target.value }); setConfirmed(false); }} /> : <textarea className={textAreaClass} required={field !== "fixProposal"} maxLength={field === "expectedBehavior" ? 4000 : field === "acceptanceCriteria" ? 10000 : 8000} value={draft[field]} onChange={event => { setDraft({ ...draft, [field]: event.target.value }); setConfirmed(false); }} />}</label>)}
      <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /><span>{t("feedbackUi.confirmScope")}</span></label>
    </fieldset>
    <div className="flex flex-wrap gap-2"><Button disabled={mutation.isPending || (!attempt && !confirmed)}>{t(attempt ? "feedbackUi.retrySame" : "feedbackUi.createTask")}</Button>{attempt && !mutation.isPending && <Button type="button" variant="outline" onClick={() => { setAttempt(null); setConfirmed(false); mutation.reset(); }}>{t("feedbackUi.resetConfirmation")}</Button>}</div>
    {mutation.isError && <p role="alert">{t("feedbackUi.confirmError")}</p>}
  </form>;
}
