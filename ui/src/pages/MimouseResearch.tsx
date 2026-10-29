import { ResearchRoutinePanel } from "@/components/mimouse-research/ResearchRoutinePanel";
import { ResearchProvenance } from "@/components/mimouse-research/ResearchProvenance";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { researchCandidateSchema, researchPromotionSchema, type ResearchCandidate, type ResearchCandidateInput, type ResearchPromotionInput, type ResearchPromotionReceipt } from "@paperclipai/shared";
import { api } from "@/api/client";
import { authApi } from "@/api/auth";
import { queryKeys } from "@/lib/queryKeys";
import { useCompany } from "@/context/CompanyContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useTranslation } from "@/i18n";
import { Link, useSearchParams } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
type Page = { items: { id: string; companyId: string; title: string; product: string; sourceCount: number; evidenceHash: string; createdAt: string }[]; nextBeforeId: string | null };
type PromotionStatus = { recorded: boolean; receipt: ResearchPromotionReceipt | null };
const area = "min-h-24 w-full rounded-md border border-border bg-background p-3 text-sm";
function useActive() { const ref = useRef(true); useEffect(() => { ref.current = true; return () => { ref.current = false; }; }, []); return ref; }
function freshDraft() { return { requestId: crypto.randomUUID() as string, title: "", product: "", currentState: "", proposedState: "", recommendation: "", sources: "[]" }; }
export function MimouseResearch() {
  const { t } = useTranslation(), { selectedCompanyId } = useCompany(), { setBreadcrumbs } = useBreadcrumbs();
  const session = useQuery({ queryKey: queryKeys.auth.session, queryFn: () => authApi.getSession(), retry: false });
  useEffect(() => setBreadcrumbs([{ label: t("researchUi.pageTitle") }]), [setBreadcrumbs, t]);
  if (!selectedCompanyId) return <p>{t("feedbackUi.chooseCompany")}</p>;
  if (session.isPending) return <p>{t("common.loading")}</p>;
  if (session.isError) return <p role="alert">{t("researchUi.readError")}</p>;
  const userId = session.data?.user?.id ?? session.data?.session?.userId ?? "local-board";
  const sessionId = session.data?.session?.id ?? "no-session";
  return <ResearchCompany key={`${selectedCompanyId}:${userId}:${sessionId}`} companyId={selectedCompanyId} userId={userId} sessionId={sessionId} />;
}
function ResearchCompany({ companyId, userId, sessionId }: { companyId: string; userId: string; sessionId: string }) {
  const { t } = useTranslation(), active = useActive(), client = useQueryClient(), [search, setSearch] = useSearchParams();
  const [draft, setDraft] = useState(freshDraft), [invalid, setInvalid] = useState(false), [notice, setNotice] = useState(""), [beforeId, setBeforeId] = useState<string>();
  const selected = search.get("candidate"), root = `/companies/${companyId}/research-candidates`, key = ["mimouse-research", companyId, userId];
  const list = useQuery({ queryKey: [...key, "list", beforeId], queryFn: () => api.get<Page>(root + (beforeId ? `?beforeId=${encodeURIComponent(beforeId)}` : "")), retry: false });
  function choose(id: string | null) { setSearch(current => { const next = new URLSearchParams(current); if (id) next.set("candidate", id); else next.delete("candidate"); return next; }, { replace: true }); }
  function edit(next: typeof draft) { setDraft(next); setInvalid(false); setNotice(""); if (selected) choose(null); }
  const create = useMutation({ mutationFn: (payload: ResearchCandidateInput) => api.post<{ item: ResearchCandidate; duplicate: boolean }>(root, payload),
    onSuccess: result => { void client.invalidateQueries({ queryKey: key }); if (active.current) { choose(result.item.id); setNotice(result.duplicate ? "duplicate" : "created"); } },
    onError: () => { void client.invalidateQueries({ queryKey: key }); } });
  if (list.isPending) return <p>{t("common.loading")}</p>;
  if (list.isError) return <div><p role="alert">{t("researchUi.readError")}</p><Button onClick={() => { void list.refetch(); }}>{t("operationsUi.retryRead")}</Button></div>;
  return <div className="space-y-6">
    <p className="text-sm text-muted-foreground">{t("researchUi.boundary")}</p>
    {userId !== "local-board" && <ResearchRoutinePanel key={`${companyId}:${userId}:${sessionId}`} companyId={companyId} userId={userId} sessionId={sessionId} />}
    <form className="space-y-3 rounded-lg border border-border p-4" onSubmit={event => {
      event.preventDefault(); if (create.isPending) return; setInvalid(false); setNotice("");
      try { const result = researchCandidateSchema.safeParse({ ...draft, sources: JSON.parse(draft.sources) }); if (!result.success) { setInvalid(true); return; } create.mutate(result.data); } catch { setInvalid(true); }
    }}>
      <h2 className="font-medium">{t("researchUi.createTitle")}</h2>
      <fieldset disabled={create.isPending} className="space-y-3">
        {(["title", "product", "currentState", "proposedState", "recommendation", "sources"] as const).map(field => <label key={field} className="block space-y-1"><span>{t(`researchUi.${field}`)}</span>
          {field === "title" || field === "product" ? <Input required maxLength={field === "title" ? 240 : 120} value={draft[field]} onChange={event => edit({ ...draft, [field]: event.target.value })} />
            : <textarea required className={area} maxLength={field === "sources" ? 140000 : field === "recommendation" ? 8000 : 4000} value={draft[field]} onChange={event => edit({ ...draft, [field]: event.target.value })} />}</label>)}
        <p className="text-xs text-muted-foreground">{t("researchUi.sourceRules")}</p>
        <p className="break-all font-mono text-xs">{t("operationsUi.requestId")}: {draft.requestId}</p>
        <div className="flex flex-wrap gap-2"><Button>{t("researchUi.save")}</Button><Button type="button" variant="outline" onClick={() => edit({ ...draft, requestId: crypto.randomUUID() })}>{t("operationsUi.newRequest")}</Button>
          <Button type="button" variant="outline" onClick={() => edit({ ...freshDraft(), title: t("researchUi.exampleTitle"), product: "Example", currentState: t("researchUi.exampleCurrent"), proposedState: t("researchUi.exampleProposed"), recommendation: t("researchUi.exampleRecommendation"), sources: JSON.stringify([{ url: "https://docs.example.invalid/guide", retrievedAt: new Date().toISOString(), evidence: t("researchUi.exampleEvidence") }], null, 2) })}>{t("operationsUi.example")}</Button></div>
      </fieldset>
      {invalid && <p role="alert">{t("researchUi.invalid")}</p>}{create.isError && <p role="alert">{t("researchUi.saveError")}</p>}
      {notice && <p role="status">{t(`researchUi.${notice}`)}</p>}
    </form>
    <section aria-label={t("researchUi.saved")} className="space-y-2"><h2 className="font-medium">{t("researchUi.saved")}</h2>
      {list.data.items.length ? list.data.items.map(row => <Button key={row.id} variant="outline" className="h-auto whitespace-normal" onClick={() => choose(row.id)}>{row.title} · {row.product}</Button>) : <p>{t("researchUi.empty")}</p>}
      <div className="flex gap-2">{beforeId && <Button variant="outline" onClick={() => setBeforeId(undefined)}>{t("feedbackUi.latest")}</Button>}{list.data.nextBeforeId && <Button variant="outline" onClick={() => setBeforeId(list.data.nextBeforeId!)}>{t("feedbackUi.older")}</Button>}</div>
    </section>
    {selected && <ResearchDetail key={`${companyId}:${userId}:${selected}`} companyId={companyId} userId={userId} id={selected} />}
  </div>;
}
function ResearchDetail({ companyId, userId, id }: { companyId: string; userId: string; id: string }) {
  const { t } = useTranslation(), query = useQuery({ queryKey: ["mimouse-research", companyId, userId, id], queryFn: () => api.get<ResearchCandidate>(`/companies/${companyId}/research-candidates/${encodeURIComponent(id)}`), retry: false });
  if (query.isPending) return <p>{t("common.loading")}</p>;
  if (query.isError || query.data.companyId !== companyId || query.data.id !== id || !["manual_import", "agent_report"].includes(query.data.evidence.evidenceMode)) return <p role="alert">{t("researchUi.readError")}</p>;
  const item = query.data;
  return <section className="space-y-3 rounded-lg border border-border p-4" aria-label={t("researchUi.evidenceTitle")}>
    <h2 className="font-medium">{item.evidence.title}</h2><p>{item.evidence.product}</p><p className="break-all font-mono text-xs">SHA-256: {item.evidenceHash}</p>
    <ResearchProvenance item={item} />
    {(["currentState", "proposedState", "recommendation"] as const).map(field => <div key={field}><h3 className="font-medium">{t(`researchUi.${field}`)}</h3><pre className="whitespace-pre-wrap break-words text-sm">{item.evidence[field]}</pre></div>)}
    <h3 className="font-medium">{t("researchUi.evidenceTitle")}</h3>
    {item.evidence.sources.map((source, index) => <div key={index} className="space-y-1 rounded border border-border p-3">
      <p className="break-all text-sm">{source.url}</p><p className="text-xs">{t("researchUi.retrievedAt")}: {source.retrievedAt}</p><pre className="whitespace-pre-wrap break-words text-sm">{source.evidence}</pre>
      {source.gap && <pre className="whitespace-pre-wrap break-words text-sm">{JSON.stringify({ product: source.product, gap: source.gap, suggestion: source.suggestion }, null, 2)}</pre>}
    </div>)}
    {item.evidence.redacted && <p className="text-xs">{t("researchUi.redacted")}</p>}
    <ResearchReview key={item.evidenceHash} companyId={companyId} userId={userId} item={item} />
  </section>;
}
function ResearchReview({ companyId, userId, item }: { companyId: string; userId: string; item: ResearchCandidate }) {
  const { t } = useTranslation(), active = useActive(), client = useQueryClient(), root = `/companies/${companyId}/research-candidates/${item.id}`, key = ["mimouse-research", companyId, userId, item.id, "promotion"];
  const status = useQuery({ queryKey: key, queryFn: () => api.get<PromotionStatus>(root + "/promotion"), enabled: userId !== "local-board", retry: false });
  const [draft, setDraft] = useState({ title: item.evidence.title, scope: "", expectedBenefit: "", acceptanceCriteria: "", dependencyIssueIds: "" });
  const [confirmed, setConfirmed] = useState(false), [invalid, setInvalid] = useState(false), [attempt, setAttempt] = useState<ResearchPromotionInput | null>(null), [receipt, setReceipt] = useState<ResearchPromotionReceipt | null>(null);
  const promote = useMutation({ mutationFn: (payload: ResearchPromotionInput) => api.post<ResearchPromotionReceipt>(root + "/promote", payload),
    onSuccess: value => { void client.invalidateQueries({ queryKey: key }); if (active.current) setReceipt(value); }, onError: () => { void client.invalidateQueries({ queryKey: key }); } });
  if (userId === "local-board") return <p>{t("feedbackUi.sessionRequired")}</p>;
  const recorded = receipt ?? status.data?.receipt;
  if (recorded) return <div><p role="status">{t("feedbackUi.confirmed")}</p><Link className="underline" to={`/issues/${recorded.issueId}`}>{t("feedbackUi.openTask")}</Link><p className="break-all font-mono text-xs">{recorded.requestId}</p></div>;
  if (status.isPending) return <p>{t("common.loading")}</p>;
  if (status.isError) return <div><p role="alert">{t("researchUi.readError")}</p><Button onClick={() => { void status.refetch(); }}>{t("operationsUi.retryRead")}</Button></div>;
  if (status.data.recorded) return <p>{t("feedbackUi.alreadyConfirmed")}</p>;
  return <form className="space-y-3 border-t border-border pt-4" onSubmit={event => {
    event.preventDefault(); if (promote.isPending) return; if (attempt) { promote.mutate(attempt); return; } if (!confirmed) return;
    const lines = (text: string) => text.split("\n").map(value => value.trim()).filter(Boolean);
    const parsed = researchPromotionSchema.safeParse({ ...draft, requestId: crypto.randomUUID(), confirm: true, expectedEvidenceHash: item.evidenceHash, acceptanceCriteria: lines(draft.acceptanceCriteria), dependencyIssueIds: lines(draft.dependencyIssueIds) });
    if (!parsed.success) { setInvalid(true); return; } setAttempt(parsed.data); promote.mutate(parsed.data);
  }}>
    <h3 className="font-medium">{t("researchUi.reviewTitle")}</h3><p className="text-sm text-muted-foreground">{t("researchUi.reviewBoundary")}</p>
    <fieldset disabled={promote.isPending || attempt !== null} className="space-y-3">
      {(["title", "scope", "expectedBenefit", "acceptanceCriteria", "dependencyIssueIds"] as const).map(field => <label key={field} className="block space-y-1"><span>{t(`researchUi.${field}`)}</span>
        <textarea className={area} required={field !== "dependencyIssueIds"} maxLength={field === "title" ? 240 : field === "expectedBenefit" ? 4000 : 10000} value={draft[field]} onChange={event => { setDraft({ ...draft, [field]: event.target.value }); setConfirmed(false); setInvalid(false); }} /></label>)}
      <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /><span>{t("researchUi.confirmScope")}</span></label>
    </fieldset>
    <div className="flex flex-wrap gap-2"><Button disabled={promote.isPending || (!attempt && !confirmed)}>{t(attempt ? "feedbackUi.retrySame" : "feedbackUi.createTask")}</Button>
      {attempt && !promote.isPending && <Button type="button" variant="outline" onClick={() => { setAttempt(null); setConfirmed(false); promote.reset(); }}>{t("feedbackUi.resetConfirmation")}</Button>}</div>
    {invalid && <p role="alert">{t("researchUi.invalid")}</p>}{promote.isError && <p role="alert">{t("feedbackUi.confirmError")}</p>}
  </form>;
}
