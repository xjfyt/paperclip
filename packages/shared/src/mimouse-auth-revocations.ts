import { z } from "zod";
export const revokeLocalAuthSchema = z.object({
  requestId: z.string().uuid(),
  confirmUserId: z.string().min(1).max(256),
  reason: z.enum(["offboarding", "compromised", "administrative"]),
}).strict();
export type RevokeLocalAuthInput = z.infer<typeof revokeLocalAuthSchema>;
export interface AuthRevocationDto {
  requestId: string; targetUserId: string; actorUserId: string; reason: RevokeLocalAuthInput["reason"];
  cutoffAt: string; sessionsRevoked: number; boardKeysRevoked: number; createdAt: string;
}
