import type { ResearchRoutineProvenance, ResearchRoutineReportInput } from "@paperclipai/shared/mimouse-research-routines";
import { researchRoutineReportSchema } from "@paperclipai/shared/mimouse-research-routines";
import { prepareResearchEvidence, researchDigest } from "../mimouse-research/evidence.js";
import { createFeedbackRedactionState } from "../feedback-redaction.js";
import { sanitizeImportedFeedbackText } from "../mimouse-feedback.js";
export function prepareResearchReport(raw: ResearchRoutineReportInput, provenance: ResearchRoutineProvenance) {
  const input = researchRoutineReportSchema.parse(raw);
  const { routineRunId: _routineRunId, issueId: _issueId, sources, ...body } = input;
  const prepared = prepareResearchEvidence({ ...body, requestId: provenance.runId,
    sources: sources.map(({ url, retrievedAt, evidence }) => ({ url, retrievedAt, evidence })) });
  const redaction = createFeedbackRedactionState();
  const clean = (value: string, key: string, max: number) => sanitizeImportedFeedbackText(value, redaction, key, max);
  const evidence = { ...prepared.evidence, evidenceMode: "agent_report" as const, provenance,
    sources: prepared.evidence.sources.map((source, i) => ({ ...source,
      product: clean(sources[i].product, `sources.${i}.product`, 120),
      gap: clean(sources[i].gap, `sources.${i}.gap`, 4000), suggestion: clean(sources[i].suggestion, `sources.${i}.suggestion`, 4000),
    })) };
  evidence.redacted ||= redaction.redactedFields.size > 0;
  return { requestId: provenance.runId, requestDigest: researchDigest({ input, companyId: provenance.companyId, routineId: provenance.routineId, runId: provenance.runId, agentId: provenance.agentId }), evidence, evidenceHash: researchDigest(evidence) };
}
