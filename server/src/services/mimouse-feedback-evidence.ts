import { createHash } from "node:crypto";
import type { FeedbackInboxItem, FeedbackEvidence, FeedbackEvidencePage } from "@paperclipai/shared";

export const FEEDBACK_EVIDENCE_ALGORITHM = "redacted-error-stack-v1" as const;
export const FEEDBACK_EVIDENCE_SCAN_LIMIT = 50;
const MAX_TEXT = 32000;
const MAX_LINE = 500;
const unknown = /^(?:unknown|unspecified|n\/a|none|null|undefined|not available|[-?]|未知|未指定|无|\[redacted[^\]]*\])$/i;
export function hasFeedbackGroupingMetadata(item: Pick<FeedbackInboxItem, "product" | "softwareVersion">) {
  return [item.product, item.softwareVersion].every(value => typeof value === "string" && value.trim().length > 0 && !unknown.test(value.trim()) && !/\[REDACTED/i.test(value));
}
/** Input must be an already-redacted inbox row. Never fetch or interpret instructions. */
export function feedbackEvidence(item: FeedbackInboxItem): FeedbackEvidence {
  const lines = item.text.slice(0, MAX_TEXT).split(/\r?\n/).slice(0, 1000);
  // Conservative JS/JVM-style error plus contiguous stack frames; no semantic inference.
  const start = lines.findIndex(line => line.length <= MAX_LINE && /^\s*(?:[A-Za-z_$][\w.$]*(?:Error|Exception)|Error|Exception):\s*\S/.test(line));
  const excerpts: FeedbackEvidence["excerpts"] = [];
  if (start >= 0) {
    excerpts.push({ line: start + 1, text: lines[start] });
    for (let i = start + 1; i < lines.length && excerpts.length < 6; i++) {
      if (lines[i].length > MAX_LINE || !/^\s+at\s+\S/.test(lines[i])) break;
      excerpts.push({ line: i + 1, text: lines[i] });
    }
  }
  // Preserve messages, identifiers and line numbers: false negatives are safer than broad buckets.
  const fingerprint = hasFeedbackGroupingMetadata(item) && excerpts.length >= 2 && !excerpts.some(value => /\[REDACTED/i.test(value.text))
    ? createHash("sha256").update(JSON.stringify([FEEDBACK_EVIDENCE_ALGORITHM, item.companyId, item.product, item.softwareVersion, ...excerpts.map(value => value.text.trim())])).digest("hex") : null;
  return { feedbackId: item.id, sourceKind: item.sourceKind, sourceInstance: item.sourceInstance, externalId: item.externalId,
    product: item.product, softwareVersion: item.softwareVersion, commitSha: item.commitSha, traceId: item.traceId,
    occurredAt: item.occurredAt, fingerprint, excerpts,
    checklist: { versionReference: hasFeedbackGroupingMetadata(item), commitReference: Boolean(item.commitSha), traceReference: Boolean(item.traceId), errorStackExcerpt: excerpts.length >= 2, reproduction: "not_performed", expectedBehavior: "requires_review", regressionTest: "requires_review" } };
}
export function feedbackEvidencePage(source: FeedbackInboxItem, candidates: FeedbackInboxItem[], nextBeforeId: string | null): FeedbackEvidencePage {
  const evidence = feedbackEvidence(source);
  const bounded = candidates.slice(0, FEEDBACK_EVIDENCE_SCAN_LIMIT);
  return { algorithmVersion: FEEDBACK_EVIDENCE_ALGORITHM, autoMerged: false, source: evidence,
    items: evidence.fingerprint ? bounded.filter(item => item.companyId === source.companyId && item.id !== source.id && item.product === source.product && item.softwareVersion === source.softwareVersion)
      .map(feedbackEvidence).filter(item => item.fingerprint === evidence.fingerprint) : [],
    scanned: bounded.length, scanLimit: FEEDBACK_EVIDENCE_SCAN_LIMIT, nextBeforeId };
}
