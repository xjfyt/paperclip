import { z } from "zod";
const uuid = z.string().uuid(), digest = z.string().regex(/^[a-f0-9]{64}$/);
export const createEvaluationRestoreSchema = z.object({ requestId: uuid, reportId: uuid, expectedReportHash: digest, expectedCurrentVersionId: uuid,
  action: z.enum(["activate", "rollback"]), rollbackOf: uuid.optional(), confirm: z.literal(true) }).strict()
  .refine(value => value.action === "rollback" ? Boolean(value.rollbackOf) : !value.rollbackOf, "Rollback requires its activation receipt");
export const recoverEvaluationRestoreSchema = z.object({ expectedOperationHash: digest, resolution: z.enum(["apply", "compensate"]), confirm: z.literal(true) }).strict();
export type CreateEvaluationRestore = z.infer<typeof createEvaluationRestoreSchema>;
export type RecoverEvaluationRestore = z.infer<typeof recoverEvaluationRestoreSchema>;
export interface EvaluationRestoreReceipt {
  id: string; companyId: string; skillId: string; reportId: string; action: "activate" | "rollback"; rollbackOf: string | null;
  status: "prepared" | "applied" | "compensated"; resolution: "apply" | "compensate"; beforeVersionId: string; targetVersionId: string;
  beforeHash: string; targetHash: string; operationHash: string; actorUserId: string; completedByUserId: string | null;
  createdAt: string; completedAt: string | null; errorCode: string | null;
}
