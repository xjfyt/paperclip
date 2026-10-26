import { z } from "zod";
export function isSafeOperationField(value: string) {
  const normalized = value.normalize("NFKC");
  return /^[\p{L}][\p{L}\p{N}_]{0,79}$/u.test(value)
    && !["constructor", "prototype", "__proto__"].includes(normalized.toLowerCase())
    && !/secret|token|password|passwd|credential|cookie|authorization|private_?key|密钥|密码|令牌|凭据|授权/i.test(normalized);
}
const identity = z.string().min(1).max(160).refine(value => value.trim() === value && !/[\u0000-\u001f]/u.test(value));
const field = z.string().refine(isSafeOperationField, "Sensitive or unsafe field");
const scalar = z.union([z.string().max(4000), z.number().int().safe(), z.boolean(), z.null()]);
const values = z.record(field, scalar).refine(value => Object.keys(value).length <= 50, "At most 50 fields");
export const operationPreviewInputSchema = z.object({
  companyId: z.string().uuid(), period: z.string().regex(/^(?:19[7-9]\d|[2-9]\d{3})-(?:0[1-9]|1[0-2])$/), timeZone: z.string().min(1).max(100),
  sourceInstance: identity, targetInstance: identity,
  mapping: z.array(z.object({ sourceField: field, targetField: field }).strict()).min(1).max(50),
  sourceRecords: z.array(z.object({ sourceId: identity, targetId: identity, occurredAt: z.string().datetime({ offset: true }), values }).strict()).min(1).max(1000),
  targetRecords: z.array(z.object({ targetId: identity, version: z.string().min(1).max(240).nullable(), values }).strict()).max(1000),
}).strict();
/** companyId is server-owned, never accepted from the request body. */
export const createOperationPreviewSchema = operationPreviewInputSchema.omit({ companyId: true }).extend({ requestId: z.string().uuid() }).strict()
  .refine(input => new TextEncoder().encode(JSON.stringify(input)).byteLength <= 1_000_000, "Preview input exceeds 1 MB");
export type OperationPreviewInput = z.infer<typeof operationPreviewInputSchema>;
export type CreateOperationPreviewInput = z.infer<typeof createOperationPreviewSchema>;
export type OperationScalar = z.infer<typeof scalar>;
export interface OperationPreview {
  schemaVersion: 1; companyId: string; period: string; timeZone: string; sourceInstance: string; targetInstance: string;
  mapping: Array<{ sourceField: string; targetField: string }>;
  operations: Array<{ key: string; sourceId: string; targetId: string; action: "insert" | "update" | "noop"; before: Record<string, OperationScalar> | null;
    after: Record<string, OperationScalar>; expectedTargetHash: string | null; expectedTargetVersion: string | null; sourceHash: string; afterHash: string }>;
  excluded: Array<{ sourceId: string; reason: "outside_period"; occurredAt: string; observedPeriod: string }>;
  counts: { insert: number; update: number; noop: number; excluded: number };
  evidenceMode: "imported_snapshot"; mode: "dry_run"; externalWrites: 0; previewHash: string;
}
export const requestOperationApprovalSchema = z.object({
  confirm: z.literal(true), expectedPreviewHash: z.string().regex(/^[a-f0-9]{64}$/), locale: z.enum(["en", "zh-CN", "es", "ja"]).default("en"),
}).strict();
export type RequestOperationApprovalInput = z.infer<typeof requestOperationApprovalSchema>;
export interface OperationPreviewRecord { id: string; companyId: string; requestId: string; actorId: string; preview: OperationPreview; approvalId: string | null; createdAt: string }
export interface OperationReadiness { mode: "dry_run_only"; writesSupported: false; externalWrites: 0; approval: { id: string; status: string } | null; blockers: string[] }
