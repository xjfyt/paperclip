/** Notifications settings expose immutable secret references, never credential material. */
export interface NotificationEndpointDto {
  id: string; name: string; kind: string; enabled: boolean;
  config: Record<string, unknown>; secretRef: string; secretVersion: number; configVersion: number;
}
export interface NotificationRevisionDto {
  id: string; companyId: string; endpointId: string; configVersion: number;
  snapshot: { name: string; kind: string; config: Record<string, unknown>; secretRef: string; secretVersion: number; configVersion: number };
  actorId: string; createdAt: string;
}
export interface NotificationRevisionInput {
  expectedVersion: number; name: string; kind: string; config: Record<string, unknown>; secretRef: string; secretVersion: number;
}

export interface NotificationReviewInput {
  requestId: string; confirm: true; outcome: "accepted" | "not_accepted" | "unknown"; evidence: string;
  expectedState: "accepted" | "rejected" | "indeterminate"; expectedAttempt: number;
}
export interface NotificationReviewDto {
  id: string; deliveryId: string; companyId: string; requestId: string; outcome: "accepted" | "not_accepted" | "unknown";
  evidence: string; actorId: string; observedState: string; observedAttempt: number; createdAt: string;
}

/** Applied only to newly enqueued events; critical alerts always bypass filtering/merging. */
export interface NotificationPolicyDto {
  minimumSeverity: "info" | "warning" | "critical";
  mergeWindowSeconds: number;
}
