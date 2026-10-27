import { eq } from "drizzle-orm";
import {
  capabilityEvidence, costRoutingPolicies, costRoutingPreviews,
  mimouseCodingDeliveries, mimouseCodingRepairAttempts,
  mimouseEvaluationComparisons, mimouseEvaluationDatasets, mimouseEvaluationRestores,
  mimouseFeedbackPromotions, mimouseFeedbackVerifications,
  mimouseNotificationDeliveries, mimouseNotificationEndpoints, mimouseNotificationSubscriptions,
  mimouseOperationPreviews, mimousePrivatePromptTests,
  mimousePromptApplicationDispatches, mimousePromptApplicationHeads,
  mimousePromptApplicationReceipts, mimousePromptApplications,
  mimousePromptReceipts, mimousePromptRevisions, mimousePrompts,
  mimouseResearchCandidates, mimouseResearchPromotions, mimouseResearchRoutineBindings,
  mimouseWorkbuddyConnections, mimouseWorkbuddyJobs, mimouseWorkbuddyTurns,
} from "@paperclipai/db";
import type { CompanyDeletionParticipant } from "../lib/company-deletion.js";

/** Remove dependents before ordinary runs/secrets/skills/routines/issues/agents. */
export const mimouseCompanyDeletion: CompanyDeletionParticipant = {
  async deleteCompanyData(tx, companyId) {
    // Explicit fixed order; never discover tables dynamically or disable guards.
    for (const table of [
      mimousePrivatePromptTests,
      mimousePromptApplicationDispatches, mimousePromptApplicationHeads,
      mimousePromptApplicationReceipts, mimousePromptApplications,
      mimouseFeedbackVerifications, mimouseCodingRepairAttempts,
      mimouseCodingDeliveries, mimouseFeedbackPromotions,
      mimouseEvaluationRestores, mimouseEvaluationComparisons, mimouseEvaluationDatasets,
      mimouseResearchPromotions, mimouseResearchCandidates, mimouseResearchRoutineBindings,
      mimouseOperationPreviews,
      mimouseNotificationDeliveries, mimouseNotificationSubscriptions, mimouseNotificationEndpoints,
      mimouseWorkbuddyTurns, mimouseWorkbuddyJobs, mimouseWorkbuddyConnections,
      costRoutingPreviews, costRoutingPolicies, capabilityEvidence,
    ]) {
      await tx.delete(table).where(eq(table.companyId, companyId));
    }
    // Only mutable heads are cleared. Immutable receipt/revision rows are never
    // rewritten; deleting the whole company receipt set preserves self-FK order.
    await tx.update(mimousePrompts).set({ selectedRevisionId: null, headReceiptId: null })
      .where(eq(mimousePrompts.companyId, companyId));
    await tx.delete(mimousePromptReceipts).where(eq(mimousePromptReceipts.companyId, companyId));
    await tx.delete(mimousePromptRevisions).where(eq(mimousePromptRevisions.companyId, companyId));
    await tx.delete(mimousePrompts).where(eq(mimousePrompts.companyId, companyId));
    // 0360 observation rows cascade from deliveries. Notification reviews and
    // revisions cascade from deliveries/endpoints; tokens cascade from secrets.
    // Instance-global notification rate limits and auth revocations stay intact.
  },
};
