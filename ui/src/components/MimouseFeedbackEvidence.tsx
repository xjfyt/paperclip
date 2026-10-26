import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { FeedbackEvidence, FeedbackEvidencePage } from "@paperclipai/shared";
import { privateFeedbackGet } from "@/api/private-feedback";
import { useTranslation } from "@/i18n";
import { Button } from "@/components/ui/button";

/** Render all imported text as text, never Markdown, HTML, instructions or executable URLs. */
export function MimouseFeedbackEvidence({ companyId, userId, sessionId, id, onSelect }: { companyId: string; userId: string; sessionId: string; id: string; onSelect: (id: string) => void }) {
  const { t } = useTranslation();
  const [beforeId, setBeforeId] = useState<string>();
  const evidence = useQuery({ queryKey: ["mimouse-feedback", companyId, userId, sessionId, id, "evidence", beforeId], retry: false, gcTime: 0, staleTime: 0,
    queryFn: ({ signal }) => privateFeedbackGet<FeedbackEvidencePage>(`/companies/${companyId}/feedback-inbox/${id}/evidence${beforeId ? `?beforeId=${encodeURIComponent(beforeId)}` : ""}`, signal) });
  function record(item: FeedbackEvidence) {
    return <div className="space-y-2 rounded-md border border-border p-3" key={item.feedbackId}>
      <p className="break-all font-mono text-xs">{item.feedbackId} · {item.sourceKind} · {item.sourceInstance} · {item.externalId}</p>
      <p className="break-all text-sm">{item.product} · {item.softwareVersion} · {item.occurredAt}</p>
      <p className="break-all font-mono text-xs">{t("feedbackUi.commitSha")}: {item.commitSha || t("feedbackEvidence.missing")} · {t("feedbackUi.traceId")}: {item.traceId || t("feedbackEvidence.missing")}</p>
      {item.excerpts.map(line => <pre key={line.line} className="whitespace-pre-wrap break-words bg-muted p-2 text-xs">{line.line}: {line.text}</pre>)}
      {item.feedbackId !== id && <Button variant="outline" onClick={() => onSelect(item.feedbackId)}>{t("feedbackEvidence.openSource")}</Button>}
    </div>;
  }
  return <section className="space-y-3" aria-label={t("feedbackEvidence.title")}>
    <h3 className="font-medium">{t("feedbackEvidence.title")}</h3>
    <p className="text-sm text-muted-foreground">{t("feedbackEvidence.boundary")}</p>
    {evidence.isPending || evidence.isFetching ? <p>{t("common.loading")}</p> : evidence.isError ? <p role="alert">{t("feedbackUi.readError")}</p> : <>
      <p className="break-all font-mono text-xs">{evidence.data.algorithmVersion} · {evidence.data.source.fingerprint || t("feedbackEvidence.noFingerprint")}</p>
      {record(evidence.data.source)}
      <h4 className="font-medium">{t("feedbackEvidence.checklist")}</h4>
      <ul className="space-y-1 text-sm">{(["versionReference", "commitReference", "traceReference", "errorStackExcerpt"] as const).map(key => <li key={key}>{t(`feedbackEvidence.${key}`)}: {t(evidence.data.source.checklist[key] ? "feedbackEvidence.present" : "feedbackEvidence.missing")}</li>)}</ul>
      <p className="text-sm">{t("feedbackEvidence.notReproduced")}</p>
      <p className="text-sm">{t("feedbackEvidence.pageScope", { count: evidence.data.scanned })}</p>
      {evidence.data.items.length ? evidence.data.items.map(record) : <p>{t("feedbackEvidence.noMatches")}</p>}
      <div className="flex flex-wrap gap-2">
        {beforeId && <Button variant="outline" onClick={() => setBeforeId(undefined)}>{t("feedbackUi.latest")}</Button>}
        {evidence.data.nextBeforeId && <Button variant="outline" onClick={() => setBeforeId(evidence.data.nextBeforeId!)}>{t("feedbackEvidence.nextPage")}</Button>}
      </div>
    </>}
  </section>;
}
