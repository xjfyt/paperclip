import { z } from "zod";
import { CONNECTED_NOTIFICATION_EVENTS } from "../services/mimouse-notifications/outbox.js";

// Shared instances for request validation and OpenAPI. Keep refinements in the
// runtime schema: OpenAPI describes structural constraints, not authorization.
const sha = z.string().regex(/^[a-f0-9]{40}$/);
export const codingCreateSchema = z.object({ issueId: z.string().uuid(), workspaceId: z.string().uuid(), gitlabOrigin: z.string().url(), projectId: z.number().int().positive(), secretRef: z.string().uuid(), baseSha: sha, headSha: sha, targetBranch: z.string().min(1).max(200) }).strict();
export const codingReviewSchema = z.object({ headSha: sha, baseSha: sha, digest: z.string().regex(/^[a-f0-9]{64}$/), confirm: z.literal(true) }).strict();
export const codingConfirmSchema = z.object({ headSha: sha, confirm: z.literal(true), title: z.string().min(1).max(200).optional() }).strict();
export const codingEvidenceSchema = z.object({ headSha: sha, checks: z.array(z.object({ commitSha: sha, command: z.string().min(1).max(2000), exitCode: z.number().int().nullable(), startedAt: z.string().datetime(), finishedAt: z.string().datetime(), logRef: z.string().min(1).max(2000), status: z.enum(["passed", "failed", "blocked", "not_run"]) }).strict()).max(100) }).strict();
export const codingArtifactsSchema = z.object({ headSha: sha, version: z.string().min(1).max(100), artifacts: z.array(z.object({ path: z.string().min(1).max(1000), platform: z.enum(["windows", "macos", "linux"]), arch: z.enum(["x86_64", "arm64"]), buildJob: z.string().min(1).max(200) }).strict()).min(1).max(30) }).strict();

const kinds = ["wecom_webhook", "feishu_webhook", "dingtalk_webhook_legacy", "dingtalk_app", "wechat_official_account"] as const;
const configSchema = z.object({ brand: z.enum(["feishu", "lark"]).optional(), target: z.string().max(500).optional(), robotCode: z.string().max(200).optional(), templateId: z.string().max(200).optional(), templateData: z.record(z.string(), z.object({ value: z.string().max(1000) }).strict()).optional() }).strict();
export const notificationEndpointSchema = z.object({ name: z.string().min(1).max(120), kind: z.enum(kinds), config: configSchema, secretRef: z.string().uuid(), secretVersion: z.number().int().positive() }).strict();
export const notificationSubscriptionSchema = z.object({ endpointId: z.string().uuid(), eventType: z.enum(CONNECTED_NOTIFICATION_EVENTS), locale: z.enum(["en", "zh-CN", "es", "ja"]) }).strict();
export const notificationEnabledSchema = z.object({ enabled: z.boolean() }).strict();
export const notificationTestSchema = z.object({ expectedVersion: z.number().int().positive().default(1), requestId: z.string().uuid(), confirm: z.literal(true), title: z.string().min(1).max(120), text: z.string().min(1).max(1000) }).strict();
export const notificationRevisionSchema = notificationEndpointSchema.extend({ expectedVersion: z.number().int().positive() });
export const notificationToggleSchema = notificationEnabledSchema.extend({ expectedVersion: z.number().int().positive().default(1) });
export const notificationReviewSchema = z.object({ requestId: z.string().uuid(), confirm: z.literal(true), outcome: z.enum(["accepted", "not_accepted", "unknown"]), evidence: z.string().trim().min(1).max(1000), expectedState: z.enum(["accepted", "rejected", "indeterminate"]), expectedAttempt: z.number().int().min(0) }).strict();
export const notificationRetrySchema = z.object({ requestId: z.string().uuid(), confirmReviewedOutcome: z.literal(true), acceptDuplicateRisk: z.literal(true) }).strict();

export const workbuddyCreateSchema = z.object({ connectionId: z.string().uuid(), requestKey: z.string().uuid(), prompt: z.string().min(1).max(20000), confirmRemoteExecution: z.literal(true) }).strict();
export const workbuddyPromptSchema = z.object({ requestKey: z.string().uuid(), prompt: z.string().min(1).max(20000), confirmRemoteExecution: z.literal(true) }).strict();
export const workbuddyAgentsSchema = z.object({ confirm: z.literal(true), agentIds: z.array(z.string().uuid()).max(30) }).strict();
