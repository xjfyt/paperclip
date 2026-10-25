import { createHash } from "node:crypto";
import { z } from "zod";

export const repairEnableSchema = z.object({
  enabled: z.literal(true), confirm: z.literal(true), headSha: z.string().regex(/^[a-f0-9]{40}$/),
  routineId: z.string().uuid(), expectedRoutineRevisionId: z.string().uuid(), maxAttempts: z.number().int().min(1).max(2),
  maxDurationMinutes: z.number().int().min(1).max(60), maxCostCents: z.number().int().positive().max(1000000),
}).strict();
export const repairDisableSchema = z.object({ enabled: z.literal(false), confirm: z.literal(true), headSha: z.string().regex(/^[a-f0-9]{40}$/) }).strict();
export const repairSettingsSchema = z.discriminatedUnion("enabled", [repairEnableSchema, repairDisableSchema]);
export const savedRepairPolicySchema = z.object({
  enabled: z.boolean(), revision: z.string().uuid(), headSha: z.string().regex(/^[a-f0-9]{40}$/),
  routineId: z.string().uuid(), routineRevisionId: z.string().uuid(), ownerUserId: z.string().min(1),
  agentId: z.string().uuid(), agentConfigHash: z.string().regex(/^[a-f0-9]{64}$/),
  maxAttempts: z.number().int().min(1).max(2), maxCostCents: z.number().int().positive().max(1000000),
  approvedAt: z.string().datetime(), expiresAt: z.string().datetime(),
}).strict().refine(value => Date.parse(value.expiresAt) > Date.parse(value.approvedAt) && Date.parse(value.expiresAt) - Date.parse(value.approvedAt) <= 3600000);
export type RepairPolicy = z.infer<typeof savedRepairPolicySchema>;
export function repairAgentConfigHash(agent: { adapterType: string; adapterConfig: unknown; runtimeConfig: unknown }) {
  const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : value && typeof value === "object"
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)])) : value;
  return createHash("sha256").update(JSON.stringify(stable({ adapterType: agent.adapterType, adapterConfig: agent.adapterConfig, runtimeConfig: agent.runtimeConfig }))).digest("hex");
}
