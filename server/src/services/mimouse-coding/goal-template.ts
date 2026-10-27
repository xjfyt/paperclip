import { and, eq } from "drizzle-orm";
import { companyMemberships, documents, issueDocuments, issues, type Db } from "@paperclipai/db";
import { CODING_GOAL_DOCUMENT_KEY, codingGoalDocument, readCodingGoalDocument, saveCodingGoalSchema, type CodingGoalReceipt } from "@paperclipai/shared";
import { canActorReadIssuePrivacy, type AuthorizationActor } from "../authorization.js";
import { documentService } from "../documents.js";
import { logActivity, publishActivity, type ActivityPublication } from "../activity-log.js";
import { forbidden, notFound, unprocessable } from "../../errors.js";

export function codingGoalService(db: Db) {
  async function read(issueId: string): Promise<CodingGoalReceipt> {
    const doc = await documentService(db).getIssueDocumentByKey(issueId, CODING_GOAL_DOCUMENT_KEY);
    if (!doc) return { issueId, revisionId: null, goal: null, planningOnly: true };
    try { return { issueId, revisionId: doc.latestRevisionId, goal: readCodingGoalDocument(doc.body!), planningOnly: true }; }
    catch { throw unprocessable("coding_goal_document_invalid"); }
  }
  return {
    read,
    async save(companyId: string, issueId: string, input: unknown, actor: { actorType: "user" | "agent" | "system"; actorId: string }, privacyActor: AuthorizationActor) {
      const parsed = saveCodingGoalSchema.parse(input); const body = codingGoalDocument(parsed.goal);
      const publications: ActivityPublication[] = [];
      const receipt = await db.transaction(async tx => {
        if (privacyActor.source !== "local_implicit" && !privacyActor.isInstanceAdmin) {
          const [membership] = await tx.select().from(companyMemberships).where(and(eq(companyMemberships.companyId, companyId),
            eq(companyMemberships.principalType, "user"), eq(companyMemberships.principalId, privacyActor.userId ?? ""))).for("share");
          if (membership?.status !== "active" || !["owner", "admin"].includes(membership.membershipRole ?? "")) throw forbidden("Company administrator required");
        }
        const [issue] = await tx.select().from(issues).where(and(eq(issues.id, issueId), eq(issues.companyId, companyId))).for("update");
        if (!issue || !await canActorReadIssuePrivacy(tx, privacyActor, issue)) throw notFound("Coding task not found");
        // Serialize this editor and protect revision reads against document writes.
        await tx.select({ id: documents.id }).from(issueDocuments).innerJoin(documents, eq(issueDocuments.documentId, documents.id))
          .where(and(eq(issueDocuments.issueId, issueId), eq(issueDocuments.key, CODING_GOAL_DOCUMENT_KEY))).for("update");
        const docs = documentService(tx as unknown as Db);
        const current = await docs.getIssueDocumentByKey(issueId, CODING_GOAL_DOCUMENT_KEY);
        if (current?.body === body) return { issueId, revisionId: current.latestRevisionId, goal: parsed.goal, planningOnly: true as const };
        const saved = await docs.upsertIssueDocument({ issueId, key: CODING_GOAL_DOCUMENT_KEY,
          title: "Coding goal", format: "markdown", body, baseRevisionId: parsed.baseRevisionId,
          createdByUserId: actor.actorType === "user" ? actor.actorId : null, lockedDocumentStrategy: "conflict" });
        await logActivity(tx as unknown as Db, { companyId, actorType: actor.actorType, actorId: actor.actorId,
          action: "coding.goal.saved", entityType: "issue", entityId: issueId,
          details: { documentId: saved.document.id, revisionId: saved.document.latestRevisionId, planningOnly: true } }, publications);
        return { issueId, revisionId: saved.document.latestRevisionId, goal: parsed.goal, planningOnly: true as const };
      });
      publications.forEach(publishActivity); return receipt;
    },
  };
}
