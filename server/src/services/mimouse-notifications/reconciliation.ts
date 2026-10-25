import { and, desc, eq } from "drizzle-orm";
import { mimouseNotificationDeliveries as deliveries, mimouseNotificationReviews as reviews, type Db } from "@paperclipai/db";
import { conflict, notFound, unprocessable } from "../../errors.js";
import type { NotificationReviewInput as SharedReviewInput } from "@paperclipai/shared";
export type NotificationReviewInput = Omit<SharedReviewInput, "confirm">;
/** A human observation is evidence, not a forged provider receipt or new send. */
export function notificationReconciliation(db: Db) {
  async function load(companyId: string, id: string) {
    const [row] = await db.select().from(deliveries).where(and(eq(deliveries.companyId, companyId), eq(deliveries.id, id)));
    if (!row) throw notFound("Delivery not found"); return row;
  }
  return {
    async history(companyId: string, id: string) {
      await load(companyId, id);
      return db.select().from(reviews).where(and(eq(reviews.companyId, companyId), eq(reviews.deliveryId, id))).orderBy(desc(reviews.createdAt), desc(reviews.id)).limit(100);
    },
    async record(companyId: string, id: string, input: NotificationReviewInput, actorId: string) {
      return db.transaction(async tx => {
        const [row] = await tx.select().from(deliveries).where(and(eq(deliveries.companyId, companyId), eq(deliveries.id, id))).for("update");
        if (!row) throw notFound("Delivery not found");
        const [existing] = await tx.select().from(reviews).where(and(eq(reviews.companyId, companyId), eq(reviews.deliveryId, id), eq(reviews.requestId, input.requestId)));
        if (existing) {
          if (existing.actorId !== actorId || existing.outcome !== input.outcome || existing.evidence !== input.evidence || existing.observedState !== input.expectedState || existing.observedAttempt !== input.expectedAttempt) throw conflict("Reconciliation request ID already has different evidence");
          return existing;
        }
        if (!["accepted", "rejected", "indeterminate"].includes(row.state)) throw unprocessable("Only settled or unknown deliveries may be reviewed");
        if (row.state !== input.expectedState || row.attempt !== input.expectedAttempt) throw conflict("Delivery changed; reload before recording an observation");
        const [review] = await tx.insert(reviews).values({ companyId, deliveryId: id, requestId: input.requestId, outcome: input.outcome, evidence: input.evidence, actorId, observedState: row.state, observedAttempt: row.attempt }).returning();
        // Deliberately no delivery status, attempt, snapshot, lease or receipt update.
        return review;
      });
    },
  };
}
