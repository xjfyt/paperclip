import type { NotificationReviewDto } from "./mimouse-notifications.js";

/** Observations are not read receipts, dispatch permission or provider certification. */
export interface NotificationVerificationScope {
  endpointId: string; configVersion: number; verificationEpoch: number;
  kind: string; secretRef: string; secretVersion: number;
}
export type NotificationCredentialStatus = "metadata_active" | "unavailable" | "unpinned_external";
export interface NotificationDeliveryObservation {
  id: string; eventId: string; subscriptionId: string; state: string; attempt: number; lastCode: string | null;
  configVersion: number | null; verificationEpoch: number | null; secretVersion: number | null;
  scopeMatches: boolean; eventType: string; resourceId: string | null;
  createdAt: string; updatedAt: string; review: NotificationReviewDto | null;
}
export interface NotificationVerificationDto {
  scope: NotificationVerificationScope;
  configuration: "saved_not_revalidated";
  credentialStatus: NotificationCredentialStatus;
  endpointEnabled: boolean; dispatchEnabled: boolean;
  implemented: true; machineVerified: false;
  latestTest: NotificationDeliveryObservation | null;
  latestApproval: NotificationDeliveryObservation | null;
}

export function notificationSnapshotMatches(scope: NotificationVerificationScope, snapshot: Record<string, unknown>) {
  return snapshot.configVersion === scope.configVersion && snapshot.verificationEpoch === scope.verificationEpoch
    && snapshot.secretRef === scope.secretRef && snapshot.secretVersion === scope.secretVersion && snapshot.kind === scope.kind;
}
