import type { ResearchCandidate } from "@paperclipai/shared";
import { useTranslation } from "@/i18n";
import { Link } from "@/lib/router";
import { researchRoutineCopy } from "./copy";
export function ResearchProvenance({ item }: { item: ResearchCandidate }) {
  const { i18n } = useTranslation(), copy = researchRoutineCopy[i18n.language as keyof typeof researchRoutineCopy] ?? researchRoutineCopy.en;
  const provenance = item.evidence.provenance;
  return <div className="space-y-2 text-sm">
    <p>{item.evidence.evidenceMode === "agent_report" ? copy.report : copy.manual}</p>
    {provenance && <details><summary>{copy.provenance}</summary>
      <p>{copy.received}: {item.createdAt}</p>
      <div className="flex flex-wrap gap-3"><Link className="underline" to={`/routines/${provenance.routineId}`}>{copy.routine}</Link><Link className="underline" to={`/issues/${provenance.issueId}`}>{copy.task}</Link></div>
      <pre className="whitespace-pre-wrap break-words text-xs">{JSON.stringify(provenance, null, 2)}</pre>
    </details>}
  </div>;
}
