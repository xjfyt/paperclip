import { and, desc, eq, sql } from "drizzle-orm";
import { companySecrets, companySecretVersions, companySecretProviderConfigs, mimouseNotificationEndpoints as endpoints,
  mimouseNotificationDeliveries as deliveries, mimouseNotificationReviews as reviews, mimouseNotificationSubscriptions as subscriptions, type Db } from "@paperclipai/db";
import { notificationSnapshotMatches, type NotificationCredentialStatus, type NotificationDeliveryObservation,
  type NotificationVerificationScope, type NotificationVerificationDto } from "@paperclipai/shared/notification-verification";
import { notFound } from "../../errors.js";

export function notificationScope(endpoint: typeof endpoints.$inferSelect): NotificationVerificationScope {
  return { endpointId: endpoint.id, configVersion: endpoint.configVersion, verificationEpoch: endpoint.verificationEpoch,
    kind: endpoint.kind, secretRef: endpoint.secretRef, secretVersion: endpoint.secretVersion };
}

/** Metadata only. Never resolve credentials, refresh a token or probe a provider. */
export async function notificationCredentialStatus(db: Db, companyId: string, scope: NotificationVerificationScope): Promise<NotificationCredentialStatus> {
  const [secret] = await db.select({ id: companySecrets.id, provider: companySecrets.provider, providerConfigId: companySecrets.providerConfigId,
    scope: companySecrets.scope, status: companySecrets.status, deletedAt: companySecrets.deletedAt }).from(companySecrets)
    .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.id, scope.secretRef)));
  if (!secret || secret.scope !== "company" || secret.status !== "active" || secret.deletedAt) return "unavailable";
  const [version] = await db.select({ status: companySecretVersions.status, revokedAt: companySecretVersions.revokedAt,
    providerVersionRef: companySecretVersions.providerVersionRef }).from(companySecretVersions)
    .where(and(eq(companySecretVersions.secretId, secret.id), eq(companySecretVersions.version, scope.secretVersion)));
  if (!version || version.revokedAt || ["disabled", "destroyed"].includes(version.status)) return "unavailable";
  if (secret.provider !== "local_encrypted") {
    const [provider] = await db.select({ status: companySecretProviderConfigs.status }).from(companySecretProviderConfigs).where(and(
      eq(companySecretProviderConfigs.companyId, companyId), eq(companySecretProviderConfigs.provider, secret.provider),
      secret.providerConfigId ? eq(companySecretProviderConfigs.id, secret.providerConfigId) : eq(companySecretProviderConfigs.isDefault, true),
    ));
    if (!provider || ["disabled", "coming_soon"].includes(provider.status)) return "unavailable";
    // A mutable external 'latest' reference cannot establish an exact account/version binding.
    if (!version.providerVersionRef) return "unpinned_external";
  }
  return "metadata_active";
}

export function notificationVerification(db: Db) {
  return {
    async read(companyId: string, endpointId: string): Promise<NotificationVerificationDto> {
      const [endpoint] = await db.select().from(endpoints).where(and(eq(endpoints.companyId, companyId), eq(endpoints.id, endpointId)));
      if (!endpoint) throw notFound("Notification endpoint not found");
      const scope = notificationScope(endpoint);
      async function latest(eventType: "manual.test" | "approval.requested"): Promise<NotificationDeliveryObservation | null> {
        // Query this exact endpoint/version, not the notification center's last 100 rows.
        // Include pending/failed latest attempts: never fall back to an older success.
        const [row] = await db.select({ delivery: deliveries }).from(deliveries).innerJoin(subscriptions,
          and(eq(subscriptions.companyId, deliveries.companyId), eq(subscriptions.id, deliveries.subscriptionId)))
          .where(and(eq(deliveries.companyId, companyId), eq(deliveries.endpointId, endpointId), eq(subscriptions.eventType, eventType),
            sql`${deliveries.snapshot}->>'configVersion' = ${String(scope.configVersion)}`))
          .orderBy(desc(deliveries.createdAt), desc(deliveries.id)).limit(1);
        if (!row) return null;
        const delivery = row.delivery;
        const [review] = await db.select().from(reviews).where(and(eq(reviews.companyId, companyId), eq(reviews.deliveryId, delivery.id)))
          .orderBy(desc(reviews.createdAt), desc(reviews.id)).limit(1);
        const snapshot = delivery.snapshot;
        const number = (value: unknown) => Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null;
        return { id: delivery.id, eventId: delivery.eventId, subscriptionId: delivery.subscriptionId, state: delivery.state,
          attempt: delivery.attempt, lastCode: delivery.lastCode, configVersion: number(snapshot.configVersion),
          verificationEpoch: number(snapshot.verificationEpoch), secretVersion: number(snapshot.secretVersion),
          scopeMatches: notificationSnapshotMatches(scope, snapshot), eventType,
          resourceId: typeof snapshot.policyResourceId === "string" ? snapshot.policyResourceId : typeof snapshot.renderResourceId === "string" ? snapshot.renderResourceId : null,
          createdAt: delivery.createdAt.toISOString(), updatedAt: delivery.updatedAt.toISOString(),
          review: review ? { ...review, outcome: review.outcome as "accepted" | "not_accepted" | "unknown", createdAt: review.createdAt.toISOString() } : null };
      }
      return { scope, configuration: "saved_not_revalidated", credentialStatus: await notificationCredentialStatus(db, companyId, scope),
        endpointEnabled: endpoint.enabled, dispatchEnabled: process.env.PAPERCLIP_NOTIFICATIONS_ENABLED === "true" && process.env.PAPERCLIP_NOTIFICATIONS_WORKER_ENABLED !== "false",
        implemented: true, machineVerified: false, latestTest: await latest("manual.test"), latestApproval: await latest("approval.requested") };
    },
  };
}
