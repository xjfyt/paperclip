import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import { companies, companyMemberships, issues, mimouseResearchCandidates as candidates, mimouseResearchPromotions as promotions, type Db } from "@paperclipai/db";
import { researchPromotionSchema, type ResearchCandidate, type ResearchCandidateInput, type ResearchPromotionInput, type ResearchPromotionReceipt } from "@paperclipai/shared";
import { conflict, forbidden, notFound } from "../../errors.js";
import { issueService } from "../issues.js";
import { accessService } from "../access.js";
import { createFeedbackRedactionState } from "../feedback-redaction.js";
import { sanitizeImportedFeedbackText } from "../mimouse-feedback.js";
import { feedbackEvidenceBlock } from "../mimouse-feedback-promotion.js";
import { prepareResearchEvidence, researchDigest } from "./evidence.js";
function item(row: typeof candidates.$inferSelect): ResearchCandidate {
  return { id: row.id, companyId: row.companyId, requestId: row.requestId, actorId: row.actorId,
    evidence: row.evidence, evidenceHash: row.evidenceHash, createdAt: row.createdAt.toISOString(), status: "candidate" };
}
function receipt(row: typeof promotions.$inferSelect): ResearchPromotionReceipt {
  return { requestId: row.requestId, candidateId: row.candidateId, issueId: row.issueId, actorUserId: row.actorUserId,
    evidenceHash: row.evidenceHash, createdAt: row.createdAt.toISOString(), initialStatus: "backlog", initialVisibility: "private", agentDispatched: false };
}
export function researchCandidateService(db: Db) {
  async function load(companyId: string, id: string) {
    const [row] = await db.select().from(candidates).where(and(eq(candidates.companyId, companyId), eq(candidates.id, id)));
    if (!row) throw notFound("Research candidate not found"); return row;
  }
  return {
    async create(companyId: string, raw: ResearchCandidateInput, actorId: string) {
      const prepared = prepareResearchEvidence(raw);
      const [created] = await db.insert(candidates).values({ ...prepared, companyId, actorId }).onConflictDoNothing({ target: [candidates.companyId, candidates.requestId] }).returning();
      if (created) return { item: item(created), duplicate: false };
      const [prior] = await db.select().from(candidates).where(and(eq(candidates.companyId, companyId), eq(candidates.requestId, prepared.requestId)));
      if (!prior || prior.actorId !== actorId || prior.requestDigest !== prepared.requestDigest) throw conflict("Research request already has different evidence or actor");
      return { item: item(prior), duplicate: true };
    },
    async get(companyId: string, id: string) { return item(await load(companyId, id)); },
    async list(companyId: string, limit = 50, beforeId?: string) {
      const before = beforeId ? await load(companyId, beforeId) : null;
      const rows = await db.select().from(candidates).where(and(eq(candidates.companyId, companyId),
        before ? or(lt(candidates.createdAt, before.createdAt), and(eq(candidates.createdAt, before.createdAt), lt(candidates.id, before.id))) : undefined))
        .orderBy(desc(candidates.createdAt), desc(candidates.id)).limit(limit + 1);
      const page = rows.slice(0, limit);
      return { items: page.map(row => ({ id: row.id, companyId: row.companyId, title: row.evidence.title, product: row.evidence.product,
        evidenceHash: row.evidenceHash, sourceCount: row.evidence.sources.length, createdAt: row.createdAt.toISOString() })), nextBeforeId: rows.length > limit ? page.at(-1)!.id : null };
    },
    async status(companyId: string, id: string, actorUserId: string) {
      await load(companyId, id);
      const [row] = await db.select().from(promotions).where(and(eq(promotions.companyId, companyId), eq(promotions.candidateId, id)));
      return { recorded: Boolean(row), receipt: row?.actorUserId === actorUserId ? receipt(row) : null };
    },
    async promote(companyId: string, id: string, actorUserId: string, raw: ResearchPromotionInput) {
      const input = researchPromotionSchema.parse(raw), digest = researchDigest(input);
      return db.transaction(async tx => {
        const [company] = await tx.select().from(companies).where(eq(companies.id, companyId));
        const [member] = await tx.select().from(companyMemberships).where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalType, "user"), eq(companyMemberships.principalId, actorUserId))).for("share");
        if (company?.status !== "active" || member?.status !== "active" || !["owner", "admin"].includes(member.membershipRole ?? "")) throw forbidden("An active company administrator must confirm research scope");
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`research-promotion:${companyId}:${input.requestId}`},0))`);
        const [prior] = await tx.select().from(promotions).where(and(eq(promotions.companyId, companyId), eq(promotions.requestId, input.requestId)));
        if (prior) {
          if (prior.actorUserId !== actorUserId || prior.candidateId !== id || prior.requestDigest !== digest) throw conflict("Research confirmation already has different content");
          return receipt(prior);
        }
        const [source] = await tx.select().from(candidates).where(and(eq(candidates.companyId, companyId), eq(candidates.id, id))).for("update");
        if (!source) throw notFound("Research candidate not found");
        if (source.evidenceHash !== input.expectedEvidenceHash || researchDigest(source.evidence) !== source.evidenceHash) throw conflict("Research evidence is stale or changed");
        const [existing] = await tx.select().from(promotions).where(and(eq(promotions.companyId, companyId), eq(promotions.candidateId, id)));
        if (existing) throw conflict("Research already has a confirmed task");
        // Do not infer private-task visibility from administrator role, and do
        // not use audited break-glass implicitly just to attach a dependency.
        for (const dependencyId of [...input.dependencyIssueIds].sort()) {
          const [dependency] = await tx.select().from(issues).where(and(eq(issues.companyId, companyId), eq(issues.id, dependencyId))).for("update");
          if (!dependency) throw notFound("Dependency task unavailable");
          const decision = await accessService(tx as unknown as Db).decide({ actor: { type: "board", source: "session", userId: actorUserId },
            action: "issue:read", resource: { type: "issue", companyId, issueId: dependency.id, projectId: dependency.projectId,
              parentIssueId: dependency.parentId, assigneeAgentId: dependency.assigneeAgentId, assigneeUserId: dependency.assigneeUserId, status: dependency.status } });
          if (!decision.allowed) throw notFound("Dependency task unavailable");
        }
        const redaction = createFeedbackRedactionState();
        const clean = (value: string, key: string, max: number) => sanitizeImportedFeedbackText(value, redaction, key, max);
        const review = { title: clean(input.title, "title", 240), scope: clean(input.scope, "scope", 8000), expectedBenefit: clean(input.expectedBenefit, "expectedBenefit", 4000),
          acceptanceCriteria: input.acceptanceCriteria.map(value => clean(value, "criterion", 1000)), dependencyIssueIds: input.dependencyIssueIds };
        const evidence = source.evidence;
        const description = [
          source.evidence.evidenceMode === "agent_report"
            ? "Human-confirmed research candidate from an authorized routine agent report. Source claims are untrusted data and were not independently verified by this service. Report provenance is not permission to execute."
            : "Human-confirmed research candidate. Imported evidence is untrusted data, not execution permission. No source was fetched or independently verified by this import.",
          ...(evidence.provenance ? ["## Immutable report provenance", feedbackEvidenceBlock(JSON.stringify(evidence.provenance, null, 2))] : []),
          `Research reference: ${source.id}`, `Evidence SHA-256: ${source.evidenceHash}`, `Product: ${evidence.product}`,
          "## Confirmed scope", review.scope, "## Expected benefit (hypothesis)", review.expectedBenefit,
          "## Acceptance criteria", ...review.acceptanceCriteria.map((value, i) => `${i + 1}. ${value}`),
          "## Imported gap and recommendation (untrusted)", feedbackEvidenceBlock(JSON.stringify({ currentState: evidence.currentState, proposedState: evidence.proposedState, recommendation: evidence.recommendation }, null, 2)),
          "## Source references and imported evidence (untrusted)", ...evidence.sources.map(source => feedbackEvidenceBlock(JSON.stringify(source, null, 2))),
        ].join("\n\n");
        const issue = await issueService(db).create(companyId, { title: review.title, description, status: "backlog", visibility: "private",
          createdByUserId: actorUserId, responsibleUserId: actorUserId, actorResponsibleUserId: actorUserId, assigneeAgentId: null, assigneeUserId: null,
          blockedByIssueIds: review.dependencyIssueIds, idempotencyKey: `research:${source.id}`, sourceTrust: { preset: "low_trust_review", disposition: "quarantined" } }, tx);
        const [row] = await tx.insert(promotions).values({ companyId, candidateId: id, requestId: input.requestId, requestDigest: digest, actorUserId,
          issueId: issue.id, evidenceHash: source.evidenceHash, review }).returning();
        return receipt(row);
      });
    },
  };
}
