import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ResearchHistoryPage } from "@paperclipai/shared/mimouse-research-history";
import { researchPrivateGet } from "@/api/research-private";
import { useTranslation } from "@/i18n";
import { Link } from "@/lib/router";
import { Button } from "@/components/ui/button";
type Props = { companyId: string; userId: string; sessionId: string; routineId: string };
export function ResearchRoutineHistory(props: Props) {
  return <History key={JSON.stringify([props.companyId, props.userId, props.sessionId, props.routineId])} {...props} />;
}
function History({ companyId, userId, sessionId, routineId }: Props) {
  const { t } = useTranslation(), [beforeId, setBeforeId] = useState<string>();
  const query = useQuery({ queryKey: ["research-routine-history", companyId, userId, sessionId, routineId, beforeId],
    queryFn: ({ signal }) => researchPrivateGet<ResearchHistoryPage>(`/companies/${companyId}/research-routines/${routineId}/history${beforeId ? `?beforeId=${encodeURIComponent(beforeId)}` : ""}`, signal),
    retry: false, gcTime: 0, refetchOnWindowFocus: false });
  const valid = query.data?.companyId === companyId && query.data?.routineId === routineId;
  const status = (value: string) => t(`researchHistoryUi.status.${value}`, { defaultValue: t("researchHistoryUi.unknown") });
  return <section className="space-y-2" aria-label={t("researchHistoryUi.title")}>
    <h3 className="font-medium">{t("researchHistoryUi.title")}</h3><p className="text-sm text-muted-foreground">{t("researchHistoryUi.boundary")}</p>
    {query.isPending ? <p role="status">{t("researchHistoryUi.loading")}</p> : query.isError || !valid ? <div role="alert"><p>{t("researchHistoryUi.error")}</p><Button variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>{t("researchHistoryUi.retry")}</Button></div> : <>
      {!query.data!.items.length && <p>{t("researchHistoryUi.empty")}</p>}
      {query.data!.items.map(item => <article key={item.id} className="space-y-2 rounded border border-border p-3">
        <p>{status(item.status)} · <time className="font-mono text-xs">{item.createdAt}</time></p>
        <p>{t(`researchHistoryUi.report.${item.reportState}`, { defaultValue: t("researchHistoryUi.unknown") })}</p>
        {item.issueId && <Link className="underline" to={`/issues/${item.issueId}`}>{t("researchRoutineUi.task")}</Link>}
        {item.attempts.map(attempt => <p key={attempt.id}>{t("researchHistoryUi.attempt")}: {status(attempt.status)} · <span className="font-mono text-xs">{attempt.id}</span></p>)}
        {item.reports.map(report => <div key={report.candidateId} className="space-y-1"><Link className="underline" to={`/research-candidates?candidate=${report.candidateId}`}>{t("researchHistoryUi.receipt")}</Link><p className="font-mono text-xs">{report.receivedAt}</p><p className="break-all font-mono text-xs">SHA-256: {report.evidenceHash}</p></div>)}
      </article>)}
      <div className="flex gap-2">{beforeId && <Button variant="outline" onClick={() => setBeforeId(undefined)}>{t("researchHistoryUi.latest")}</Button>}{query.data!.nextBeforeId && <Button variant="outline" onClick={() => setBeforeId(query.data!.nextBeforeId!)}>{t("researchHistoryUi.older")}</Button>}</div>
    </>}
  </section>;
}
