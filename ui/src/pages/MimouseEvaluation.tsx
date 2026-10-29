import { authSessionScopeKey } from "@/lib/auth-session-scope";
import { MimouseEvaluationFeedback } from "./MimouseEvaluationFeedback";
import { MimouseEvaluationRestore } from "./MimouseEvaluationRestore";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createEvaluationComparisonSchema, createEvaluationDatasetSchema, type CreateEvaluationDataset, type EvaluationDatasetRecord, type EvaluationComparisonRecord } from "@paperclipai/shared/mimouse-evaluation";
import { api, ApiError } from "@/api/client";
import { privateFeedbackGet as privateEvaluationGet } from "@/api/private-feedback";
import { authApi } from "@/api/auth";
import { queryKeys } from "@/lib/queryKeys";
import { useCompany } from "@/context/CompanyContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { formatNumber, useTranslation } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
type Page<T> = { items: T[]; nextBeforeId: string | null };
type Evidence = { versions: Array<{ id: string; revision: number; label: string | null }>; inputs: Array<{ id: string; name: string }>; runs: Array<{ id: string; inputId: string | null; versionId: string; status: string; supersededAt: string | null; harnessIssueDeletedAt: string | null }> };
const area = "min-h-32 w-full rounded-md border border-border bg-background p-3 font-mono text-xs";
export function MimouseEvaluation() {
  const { t } = useTranslation(), { selectedCompanyId } = useCompany(), { setBreadcrumbs } = useBreadcrumbs();
  const session = useQuery({ queryKey: queryKeys.auth.session, queryFn: () => authApi.getSession(), retry: false });
  useEffect(() => { setBreadcrumbs([{ label: t("evaluationUi.pageTitle") }]); }, [setBreadcrumbs, t]);
  if (!selectedCompanyId) return <p>{t("feedbackUi.chooseCompany")}</p>;
  if (session.isPending || session.isFetching) return <p>{t("common.loading")}</p>;
  if (session.isError) return <p role="alert">{t("evaluationUi.readError")}</p>;
  const userId = session.data?.user?.id ?? session.data?.session?.userId ?? "local-board";
  const sessionId = authSessionScopeKey(session.data) ?? "";
  return <EvaluationCompany key={JSON.stringify([selectedCompanyId, userId, sessionId])} companyId={selectedCompanyId} userId={userId} sessionId={sessionId} />;
}
function EvaluationCompany({ companyId, userId, sessionId }: { companyId: string; userId: string; sessionId: string }) {
  const { t } = useTranslation(), client = useQueryClient(), active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const root = `/companies/${companyId}/skill-evaluations`, key = ["mimouse-evaluation", companyId, userId, sessionId];
  const [datasetCursor, setDatasetCursor] = useState<string>(), [reportCursor, setReportCursor] = useState<string>();
  const [skillId, setSkillId] = useState(""), [loadedSkill, setLoadedSkill] = useState("");
  const [name, setName] = useState(""), [cases, setCases] = useState("[]"), [datasetRequestId, setDatasetRequestId] = useState(() => crypto.randomUUID());
  const [datasetId, setDatasetId] = useState(""), [baselineVersionId, setBaseline] = useState(""), [candidateVersionId, setCandidate] = useState("");
  const [runIds, setRunIds] = useState("[]"), [budget, setBudget] = useState(""), [comparisonRequestId, setComparisonRequestId] = useState(() => crypto.randomUUID());
  const [pendingDataset, setPendingDataset] = useState<CreateEvaluationDataset | null>(null);
  const [invalid, setInvalid] = useState(false), [selected, setSelected] = useState<EvaluationComparisonRecord | null>(null);
  const datasets = useQuery({ queryKey: [...key, "datasets", datasetCursor], gcTime: 0, staleTime: 0, queryFn: ({ signal }) => privateEvaluationGet<Page<EvaluationDatasetRecord>>(`${root}/datasets${datasetCursor ? `?beforeId=${datasetCursor}` : ""}`, signal), retry: false });
  const reports = useQuery({ queryKey: [...key, "comparisons", reportCursor], gcTime: 0, staleTime: 0, queryFn: ({ signal }) => privateEvaluationGet<Page<EvaluationComparisonRecord>>(`${root}/comparisons${reportCursor ? `?beforeId=${reportCursor}` : ""}`, signal), retry: false });
  const evidence = useQuery({ queryKey: [...key, "evidence", loadedSkill], gcTime: 0, staleTime: 0, queryFn: ({ signal }) => privateEvaluationGet<Evidence>(`${root}/skills/${loadedSkill}/evidence`, signal), enabled: Boolean(loadedSkill), retry: false });
  const create = useMutation({ mutationFn: (body: ReturnType<typeof createEvaluationDatasetSchema.parse>) => api.post(`${root}/datasets`, body), onSuccess: () => { if (!active.current) return; setPendingDataset(null); void client.invalidateQueries({ queryKey: key }); },
    onError: error => { if (active.current && error instanceof ApiError && [400, 401, 403, 404, 409, 422].includes(error.status)) setPendingDataset(null); } });
  const compare = useMutation({ mutationFn: (body: ReturnType<typeof createEvaluationComparisonSchema.parse>) => api.post<{ item: EvaluationComparisonRecord }>(`${root}/comparisons`, body), onSuccess: result => { void client.invalidateQueries({ queryKey: key }); if (active.current) setSelected(result.item); } });
  const busy = create.isPending || compare.isPending || pendingDataset !== null;
  function edited() { setInvalid(false); setSelected(null); create.reset(); compare.reset(); }
  function datasetEdited() { edited(); setDatasetRequestId(crypto.randomUUID()); }
  function comparisonEdited() { edited(); setComparisonRequestId(crypto.randomUUID()); }
  if (datasets.isPending || reports.isPending || datasets.isFetching || reports.isFetching) return <p>{t("common.loading")}</p>;
  if (datasets.isError || reports.isError) return <div><p role="alert">{t("evaluationUi.readError")}</p><Button onClick={() => { void datasets.refetch(); void reports.refetch(); }}>{t("evaluationUi.retry")}</Button></div>;
  return <div className="space-y-6">
    <p className="text-sm text-muted-foreground">{t("evaluationUi.boundary")}</p>
    <section className="space-y-2 rounded-lg border border-border p-4">
      <label className="block space-y-1"><span>{t("evaluationUi.skillId")}</span><Input value={skillId} disabled={busy} onChange={event => { setSkillId(event.target.value); datasetEdited(); }} /></label>
      <Button disabled={busy || !/^[a-f0-9-]{36}$/i.test(skillId)} onClick={() => setLoadedSkill(skillId)}>{t("evaluationUi.loadEvidence")}</Button>
      <p className="text-xs text-muted-foreground">{t("evaluationUi.evidenceLimits")}</p>
      {evidence.isFetching && <p>{t("common.loading")}</p>}{evidence.isError && <p role="alert">{t("evaluationUi.readError")}</p>}
      {evidence.data && !evidence.isFetching && !evidence.isError && <details><summary>{t("evaluationUi.availableEvidence")}</summary><pre className="overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(evidence.data, null, 2)}</pre></details>}
    </section>
    <MimouseEvaluationFeedback key={skillId} root={root} skillId={skillId} disabled={busy || userId === "local-board"} onAdd={item => {
      try {
        const current: unknown = JSON.parse(cases);
        if (!Array.isArray(current) || current.length >= 100 || current.some(value => value?.inputId === item.inputId)) return false;
        setCases(JSON.stringify([...current, item], null, 2)); datasetEdited(); return true;
      } catch { return false; }
    }} />
    <form className="space-y-3 rounded-lg border border-border p-4" onSubmit={event => { event.preventDefault(); if (busy) return; setInvalid(false); try { const body = createEvaluationDatasetSchema.parse({ requestId: datasetRequestId, skillId, name, cases: JSON.parse(cases) }); if (body.cases.some(item => item.feedback)) setPendingDataset(body); create.mutate(body); } catch { setInvalid(true); } }}>
      <h2 className="font-medium">{t("evaluationUi.createDataset")}</h2>
      <fieldset disabled={busy} className="space-y-3">
        <label className="block space-y-1"><span>{t("evaluationUi.name")}</span><Input required maxLength={160} value={name} onChange={event => { setName(event.target.value); datasetEdited(); }} /></label>
        <label className="block space-y-1"><span>{t("evaluationUi.cases")}</span><textarea required maxLength={500000} className={area} value={cases} onChange={event => { setCases(event.target.value); datasetEdited(); }} /></label>
        <p className="text-xs text-muted-foreground">{t("evaluationUi.caseRules")}</p>
        <Button type="submit">{t("evaluationUi.freeze")}</Button>
      </fieldset>
      {pendingDataset && create.isError && <div role="alert" className="space-y-2"><p>{t("evaluationUi.feedbackUnknown")}</p><p className="break-all font-mono text-xs">{pendingDataset.requestId}</p><Button disabled={create.isPending} onClick={() => create.mutate(pendingDataset)}>{t("evaluationUi.feedbackRetry")}</Button></div>}
      {create.isSuccess && <p role="status">{t("evaluationUi.saved")}</p>}
    </form>
    <section className="space-y-2"><h2 className="font-medium">{t("evaluationUi.datasets")}</h2>{datasets.data.items.filter(item => item.companyId === companyId).map(item => <div key={item.id}><Button disabled={busy} variant="outline" className="h-auto w-full justify-start whitespace-normal break-all text-left" onClick={() => { setDatasetId(item.id); setLoadedSkill(item.skillId); comparisonEdited(); }}>{item.name} · {item.id} · {item.datasetHash}</Button>{item.cases?.some(value => value.feedbackSource) && <details><summary>{t("evaluationUi.feedbackStoredRefs")}</summary><pre className="overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(item.cases.filter(value => value.feedbackSource).map(value => ({ inputId: value.id, source: value.feedbackSource })), null, 2)}</pre></details>}</div>)}
      <Button variant="outline" disabled={!datasetCursor} onClick={() => setDatasetCursor(undefined)}>{t("evaluationUi.firstPage")}</Button><Button variant="outline" disabled={!datasets.data.nextBeforeId} onClick={() => setDatasetCursor(datasets.data.nextBeforeId!)}>{t("evaluationUi.nextPage")}</Button>
    </section>
    <form className="space-y-3 rounded-lg border border-border p-4" onSubmit={event => { event.preventDefault(); if (busy) return; setInvalid(false); try { compare.mutate(createEvaluationComparisonSchema.parse({ requestId: comparisonRequestId, datasetId, baselineVersionId, candidateVersionId, runIds: JSON.parse(runIds), maxCandidateCostCents: budget === "" ? null : Number(budget) })); } catch { setInvalid(true); } }}>
      <h2 className="font-medium">{t("evaluationUi.compare")}</h2>
      <fieldset disabled={busy} className="space-y-3">
        {([{ key: "datasetId", value: datasetId, set: setDatasetId }, { key: "baselineVersionId", value: baselineVersionId, set: setBaseline }, { key: "candidateVersionId", value: candidateVersionId, set: setCandidate }] as const).map(field => <label key={field.key} className="block space-y-1"><span>{t(`evaluationUi.${field.key}`)}</span><Input required value={field.value} onChange={event => { field.set(event.target.value); comparisonEdited(); }} /></label>)}
        <label className="block space-y-1"><span>{t("evaluationUi.runIds")}</span><textarea className={area} value={runIds} maxLength={10000} onChange={event => { setRunIds(event.target.value); comparisonEdited(); }} /></label>
        <label className="block space-y-1"><span>{t("evaluationUi.budget")}</span><Input type="number" min={0} step={1} value={budget} onChange={event => { setBudget(event.target.value); comparisonEdited(); }} /></label>
        <Button type="submit">{t("evaluationUi.compare")}</Button>
      </fieldset>
    </form>
    {invalid && <p role="alert">{t("evaluationUi.invalid")}</p>}{(create.isError || compare.isError) && <p role="alert">{t("evaluationUi.writeError")}</p>}
    <section className="space-y-2"><h2 className="font-medium">{t("evaluationUi.reports")}</h2>{reports.data.items.filter(item => item.companyId === companyId).map(item => <Button key={item.id} variant="outline" onClick={() => setSelected(item)}>{item.id}</Button>)}
      <Button variant="outline" disabled={!reportCursor} onClick={() => setReportCursor(undefined)}>{t("evaluationUi.firstPage")}</Button><Button variant="outline" disabled={!reports.data.nextBeforeId} onClick={() => setReportCursor(reports.data.nextBeforeId!)}>{t("evaluationUi.nextPage")}</Button>
    </section>
    {selected?.companyId === companyId && <section className="space-y-3 rounded-lg border border-border p-4">
      <h2 className="font-medium">{t("evaluationUi.report")}</h2><p className="break-all font-mono text-xs">{selected.report.reportHash}</p>
      <p>{t("evaluationUi.costNotice")}</p>
      {[selected.report.baseline, selected.report.candidate].map((summary, index) => <div key={summary.versionId} className="space-y-1"><h3>{t(index ? "evaluationUi.candidateVersionId" : "evaluationUi.baselineVersionId")}: {summary.versionId}</h3><p>{t("evaluationUi.score", { passed: formatNumber(summary.passed), total: formatNumber(summary.cases), blocked: formatNumber(summary.blocked) })}</p><p>{t("evaluationUi.cost")}: {summary.totalCostCents === null ? t("evaluationUi.unknown") : formatNumber(summary.totalCostCents, { maximumFractionDigits: 7 })} · {t("evaluationUi.knownCost")}: {formatNumber(summary.knownCostCents, { maximumFractionDigits: 7 })}</p></div>)}
      <p>{t("evaluationUi.qualityDelta")}: {formatNumber(selected.report.passCountDelta)}</p>
      <p>{t(selected.report.eligibleForHumanReview ? "evaluationUi.reviewable" : "evaluationUi.blocked")}</p>
      <ul>{selected.report.blockers.map(blocker => <li key={blocker}>{t(`evaluationUi.${blocker}`)}</li>)}</ul>
      <details><summary>{t("evaluationUi.results")}</summary><ul>{selected.report.results.map(result => <li key={`${result.versionId}:${result.caseId}`} className="break-all text-xs">{result.caseId} · {result.versionId} · {result.runId ?? "—"} · {result.supersededAt && `${t("evaluationUi.historicalRun")} · `}{t(`evaluationUi.${result.blocked ?? (result.passed ? "passed" : "failed")}`)}</li>)}</ul></details>
      <MimouseEvaluationRestore key={selected.id} companyId={companyId} userId={userId} comparison={selected} />
    </section>}
  </div>;
}
