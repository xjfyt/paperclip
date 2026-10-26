import type { ResearchCandidate } from "@paperclipai/shared";
import { useTranslation } from "@/i18n";
import { Link } from "@/lib/router";
export function ResearchProvenance({ item }: { item: ResearchCandidate }) {
  const { t } = useTranslation();
  const provenance = item.evidence.provenance;
  return <div className="space-y-2 text-sm">
    <p>{item.evidence.evidenceMode === "agent_report" ? t("researchRoutineUi.report") : t("researchRoutineUi.manual")}</p>
    {provenance && <details><summary>{t("researchRoutineUi.provenance")}</summary>
      <p>{t("researchRoutineUi.received")}: {item.createdAt}</p>
      <div className="flex flex-wrap gap-3"><Link className="underline" to={`/routines/${provenance.routineId}`}>{t("researchRoutineUi.routine")}</Link><Link className="underline" to={`/issues/${provenance.issueId}`}>{t("researchRoutineUi.task")}</Link></div>
      <pre className="whitespace-pre-wrap break-words text-xs">{JSON.stringify(provenance, null, 2)}</pre>
    </details>}
  </div>;
}
