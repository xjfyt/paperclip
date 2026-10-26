import { z } from "zod";
const uuid = z.string().uuid();
export const createPromptRevisionSchema = z.object({
  requestId: uuid,
  promptKey: z.string().regex(/^[a-z][a-z0-9_-]{0,79}$/),
  // Exact UTF-8 bytes are authoritative: never trim or interpolate content.
  content: z.string().min(1).max(64000)
    .refine(value => !value.includes("\0") && !Array.from(value).some(char => char.length === 1 && /[\uD800-\uDFFF]/.test(char)), "Invalid Unicode text")
    .refine(value => new TextEncoder().encode(value).byteLength <= 128000, "Prompt too large"),
}).strict();
const transition = { requestId: uuid, expectedHeadReceiptId: uuid.nullable(), confirmRegistryOnly: z.literal(true) };
export const selectPromptRevisionSchema = z.discriminatedUnion("action", [
  z.object({ ...transition, action: z.literal("promote"), revisionId: uuid }).strict(),
  z.object({ ...transition, action: z.literal("rollback"), rollbackOfReceiptId: uuid }).strict(),
]);
export type CreatePromptRevision = z.infer<typeof createPromptRevisionSchema>;
export type SelectPromptRevision = z.infer<typeof selectPromptRevisionSchema>;
export interface PromptRegistryHead {
  id: string; companyId: string; promptKey: string; selectedRevisionId: string | null;
  headReceiptId: string | null; runtimeApplied: false;
}
export interface PromptRevision {
  id: string; companyId: string; promptId: string; contentHash: string;
  actorUserId: string; createdAt: string;
}
export interface PromptSelectionReceipt {
  id: string; companyId: string; promptId: string; action: "promote" | "rollback";
  previousReceiptId: string | null; beforeRevisionId: string | null; selectedRevisionId: string | null;
  rollbackOfReceiptId: string | null; actorUserId: string; createdAt: string; runtimeApplied: false;
}
