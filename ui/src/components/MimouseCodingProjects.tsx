import type { MimouseCodingListPagination, MimouseCodingProjectSummary } from "@paperclipai/shared/mimouse-coding-summary";
import { useTranslation } from "@/i18n";
import { Button } from "@/components/ui/button";

/** Summary is deliberately page-local; never infer whole-project completion. */
export function MimouseCodingProjects({ summary, pagination, filtered, after, onProject, onNext, onReset, onFirst }: {
  summary?: MimouseCodingProjectSummary; pagination?: MimouseCodingListPagination; filtered: boolean; after: boolean;
  onProject: (origin: string, projectId: number) => void; onNext: (cursor: string) => void; onReset: () => void; onFirst: () => void;
}) {
  const { t } = useTranslation();
  const valid = summary?.scope === "authorized_delivery_page";
  return <section aria-label={t("codingProjects.title")} className="space-y-3 rounded-lg border border-border p-4">
    <h2 className="font-medium">{t("codingProjects.title")}</h2>
    <p className="text-sm text-muted-foreground">{t("codingProjects.scope")}</p>
    <p className="text-sm text-muted-foreground">{t("codingProjects.boundary")}</p>
    {!valid ? <p role="status">{t("codingProjects.unavailable")}</p> : summary.projects.length === 0 ? <p>{t("codingProjects.empty")}</p> :
      <ul className="space-y-3">{summary.projects.map(project => <li key={JSON.stringify([project.gitlabOrigin, project.projectId])} className="space-y-2">
        <p className="break-all font-mono text-sm">{project.gitlabOrigin} · {project.projectId}</p>
        <p className="text-sm">{t("codingProjects.counts", { deliveries: project.deliveryCount, candidates: project.candidateCount, blocked: project.blockedCount, artifacts: project.localArtifactCount })}</p>
        <Button variant="outline" onClick={() => onProject(project.gitlabOrigin, project.projectId)}>{t("codingProjects.filterProject")}</Button>
      </li>)}</ul>}
    <div className="flex flex-wrap justify-between gap-2">
      <div className="flex flex-wrap gap-2">
        {filtered && <Button variant="outline" onClick={onReset}>{t("codingProjects.reset")}</Button>}
        {after && <Button variant="outline" onClick={onFirst}>{t("codingProjects.first")}</Button>}
      </div>
      {pagination?.hasMore && pagination.nextCursor && <Button variant="outline" onClick={() => onNext(pagination.nextCursor!)}>{t("codingProjects.next")}</Button>}
    </div>
  </section>;
}
