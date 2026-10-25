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
