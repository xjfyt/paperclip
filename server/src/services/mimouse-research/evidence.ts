import { createHash } from "node:crypto";
import { researchCandidateSchema, type ResearchCandidateInput, type ResearchEvidence } from "@paperclipai/shared";
import { createFeedbackRedactionState } from "../feedback-redaction.js";
import { sanitizeImportedFeedbackText } from "../mimouse-feedback.js";
// PostgreSQL JSONB may reorder object keys. Hash values, not property insertion order.
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + canonical((value as Record<string, unknown>)[key])).join(",") + "}";
}
export const researchDigest = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
/** Imported citations are assertions, not a claim we fetched or verified a URL. */
export function prepareResearchEvidence(raw: ResearchCandidateInput) {
  const input = researchCandidateSchema.parse(raw), redaction = createFeedbackRedactionState();
  const clean = (value: string, key: string, max: number) => sanitizeImportedFeedbackText(value, redaction, key, max);
  const sources = input.sources.map((source, index) => {
    const url = new URL(source.url); url.username = ""; url.password = ""; url.search = ""; url.hash = "";
    if (url.href !== source.url) redaction.redactedFields.add(`sources.${index}.url`);
    return { url: url.href, retrievedAt: new Date(source.retrievedAt).toISOString(), evidence: clean(source.evidence, `sources.${index}.evidence`, 4000) };
  });
  const evidence: ResearchEvidence = {
    title: clean(input.title, "title", 240), product: clean(input.product, "product", 120),
    currentState: clean(input.currentState, "currentState", 4000), proposedState: clean(input.proposedState, "proposedState", 4000),
    recommendation: clean(input.recommendation, "recommendation", 8000), sources,
    evidenceMode: "manual_import", redacted: redaction.redactedFields.size > 0, redactionVersion: 1,
  };
  return { evidence, evidenceHash: researchDigest(evidence), requestDigest: researchDigest(input), requestId: input.requestId };
}
