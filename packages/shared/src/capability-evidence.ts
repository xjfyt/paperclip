import { z } from "zod";

export const evidenceCapabilities = ["localExecution", "remoteExecution", "sessionResume", "confirmedCancellation", "toolApproval", "workspaceRoundTrip", "usageReporting"] as const;
// Identifiers only: no URLs, paths, free text, headers, credentials or payloads.
const alias = z.string().min(1).max(80).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/)
  .refine(value => !/(?:bearer|password|secret|token|sk-|ghp_|github_pat_)/i.test(value), "Use a non-sensitive alias");
export const capabilityEvidenceContextSchema = z.object({
  adapterType: z.enum(["qoder_cn", "workbuddy"]),
  capability: z.enum(evidenceCapabilities),
  runtime: alias,
  runtimeVersion: alias,
  environmentAlias: alias,
  accountAlias: alias,
  testedCommit: z.string().regex(/^[a-f0-9]{40}$/),
}).strict();
export const capabilityReceiptSchema = capabilityEvidenceContextSchema.extend({
  level: z.enum(["C3", "C4"]),
  result: z.enum(["passed", "failed", "blocked"]),
  sourceResourceId: alias,
  sourceRunId: alias,
  testedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
}).strict().refine(value => {
  const duration = Date.parse(value.expiresAt) - Date.parse(value.testedAt);
  return duration > 0 && duration <= 30 * 24 * 60 * 60 * 1000;
}, "Evidence validity must be positive and at most 30 days");
export const appendCapabilityEvidenceSchema = z.object({
  expectedRevision: z.number().int().min(0).max(2147483646),
  idempotencyKey: z.string().uuid(),
  action: z.enum(["record", "revoke", "supersede"]),
  targetId: z.string().uuid().optional(),
  receipt: capabilityReceiptSchema.optional(),
  reason: z.enum(["verification", "incorrect", "expired", "environment_changed", "retested"]),
}).strict().superRefine((value, ctx) => {
  if ((value.action !== "revoke") !== Boolean(value.receipt)
    || (value.action !== "record") !== Boolean(value.targetId)) {
    ctx.addIssue({ code: "custom", message: "Receipt and target must match action" });
  }
});
export type CapabilityEvidenceContext = z.infer<typeof capabilityEvidenceContextSchema>;
export type CapabilityReceipt = z.infer<typeof capabilityReceiptSchema>;
export type AppendCapabilityEvidence = z.infer<typeof appendCapabilityEvidenceSchema>;
export type CapabilityEvidenceEvent = {
  id: string; companyId: string; revision: number; action: AppendCapabilityEvidence["action"];
  targetId: string | null; receipt: CapabilityReceipt | null; reason: AppendCapabilityEvidence["reason"];
  reviewerId: string; createdAt: string;
};
export function capabilityBaseline(adapter: string, capability: string): "C2" | "unsupported" | "unknown" {
  if (adapter === "qoder_cn") {
    if (["localExecution", "sessionResume", "confirmedCancellation", "usageReporting"].includes(capability)) return "C2";
    if (["remoteExecution", "toolApproval", "workspaceRoundTrip"].includes(capability)) return "unsupported";
  }
  if (adapter === "workbuddy") {
    if (["remoteExecution", "sessionResume"].includes(capability)) return "C2";
    if (["localExecution", "confirmedCancellation", "toolApproval", "workspaceRoundTrip"].includes(capability)) return "unsupported";
  }
  return "unknown";
}
export function sameEvidenceContext(a: CapabilityEvidenceContext, b: CapabilityEvidenceContext) {
  return Object.keys(capabilityEvidenceContextSchema.shape).every(key => a[key as keyof CapabilityEvidenceContext] === b[key as keyof CapabilityEvidenceContext]);
}
// Display-only, never a dispatch/permission decision. Callers must provide a complete history.
export function evaluateCapabilityEvidence(companyId: string, context: CapabilityEvidenceContext, events: CapabilityEvidenceEvent[], now = Date.now()) {
  const baseline = capabilityBaseline(context.adapterType, context.capability);
  const scoped = events.filter(event => event.companyId === companyId);
  const retired = new Set(scoped.flatMap(event => event.targetId ? [event.targetId] : []));
  const latest = scoped.filter(event => event.receipt && sameEvidenceContext(event.receipt, context))
    .sort((a, b) => b.revision - a.revision)[0];
  const receipt = latest?.receipt;
  const active = baseline === "C2" && latest && receipt && !retired.has(latest.id)
    && receipt.result === "passed" && Date.parse(receipt.testedAt) <= now && Date.parse(receipt.expiresAt) > now;
  return { baseline, manualAttestation: active ? receipt.level : null, machineVerified: false as const,
    latestReceiptId: latest?.id ?? null };
}
