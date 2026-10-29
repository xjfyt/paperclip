import { z } from "zod";
import {
  revokeLocalAuthSchema, feedbackImportSchema, feedbackPromotionSchema,
  researchCandidateSchema, researchPromotionSchema, createOperationPreviewSchema,
  requestOperationApprovalSchema, saveCodingGoalSchema,
  startMimouseBuildObservationSchema, closeMimouseBuildObservationSchema,
} from "@paperclipai/shared";
import { appendCapabilityEvidenceSchema } from "@paperclipai/shared/capability-evidence";
import { saveRoutingPolicySchema, createRoutingPreviewSchema } from "@paperclipai/shared/cost-routing-preview";
import {
  prepareRuntimeRoutingPolicySchema, approveRuntimeRoutingPolicySchema,
  closeExpiredRuntimeRoutingPolicySchema, disableRuntimeRoutingPolicySchema,
  createRuntimeRoutingTaskSchema, runRuntimeRoutingTaskSchema, runtimeRoutingRequestQuerySchema,
} from "@paperclipai/shared/runtime-cost-routing";
import { appendNotificationEvidenceSchema } from "@paperclipai/shared/notification-evidence";
import { feedbackRunLogSelectionSchema, feedbackRunLogImportSchema } from "@paperclipai/shared/mimouse-feedback-run-log";
import { feedbackVerificationPreviewSchema, feedbackVerificationConfirmSchema } from "@paperclipai/shared/mimouse-feedback-verification";
import { createEvaluationComparisonSchema, createEvaluationDatasetSchema, previewEvaluationFeedbackSchema } from "@paperclipai/shared/mimouse-evaluation";
import { createEvaluationRestoreSchema, recoverEvaluationRestoreSchema } from "@paperclipai/shared/mimouse-evaluation-restore";
import { createPromptRevisionSchema, selectPromptRevisionSchema } from "@paperclipai/shared/mimouse-prompt-registry";
import { preparePrivatePromptTestSchema, executePrivatePromptTestSchema, cancelPrivatePromptTestSchema } from "@paperclipai/shared/mimouse-private-prompt-tests";
import { comparePrivatePromptTestsSchema } from "@paperclipai/shared/mimouse-private-prompt-comparison";
import { preparePromptApplicationSchema, approvePromptApplicationSchema, rollbackPromptApplicationSchema, promptApplicationRequestQuerySchema } from "@paperclipai/shared/mimouse-prompt-applications";
import { researchRoutineBindingSchema, researchRoutineReportSchema } from "@paperclipai/shared/mimouse-research-routines";
import { researchHistoryQuerySchema } from "@paperclipai/shared/mimouse-research-history";
import { langfuseCreateSchema } from "../services/mimouse-langfuse/protocol.js";
import { wecomConfigSchema } from "../services/mimouse-wecom/protocol.js";
import { codingListQuerySchema } from "../services/mimouse-coding/delivery-list.js";
import { repairSettingsSchema } from "../services/mimouse-coding/repair-policy.js";
import { notificationPolicyUpdateSchema } from "../services/mimouse-notifications/policy.js";
import * as body from "./mimouse-api-schemas.js";

type Auth = "board" | "session" | "instance_admin_session" | "agent_run" | "owner_or_run";
export interface MimouseOpenApiOperation {
  method: "get" | "post" | "put" | "patch";
  path: string;
  tags: string[];
  summary: string;
  description: string;
  auth: Auth;
  params?: z.ZodTypeAny;
  query?: z.ZodTypeAny;
  body?: z.ZodTypeAny;
  bodyOptional?: boolean;
  success: number[];
  redirect?: boolean;
  authorization?: Record<string, unknown>;
}
const uuid = z.string().uuid();
const page = z.object({ beforeId: uuid.optional() }).strict();
const list = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50), beforeId: uuid.optional() }).strict();
const revisions = z.object({ afterRevision: z.coerce.number().int().min(0).max(2147483646).default(0) });
const confirmed = z.object({ confirm: z.literal(true) }).strict();
const companyAdmin = "Company access plus an active owner/admin membership, instance administrator authority, or local implicit board is required. Responses do not prove live provider verification.";
const humanAdmin = "Requires a signed-in human board session and current company authorization. Board API keys, agent keys and local implicit board do not confer human confirmation authority. The service rechecks the relevant company/member/resource state.";
const operations: MimouseOpenApiOperation[] = [];
function group(root: string, tag: string, auth: Auth, description: string = companyAdmin) {
  return (method: MimouseOpenApiOperation["method"], suffix: string, summary: string,
    extra: Partial<Omit<MimouseOpenApiOperation, "method" | "path" | "tags" | "summary">> = {}) => {
    operations.push({ method, path: `/api${root}${suffix}`, tags: [tag], summary, auth, description, success: [200], ...extra });
  };
}

let add = group("/companies/{companyId}/capability-evidence", "capability-evidence", "board",
  "Company board administrator (local implicit board, instance administrator, or users:manage_permissions) only. Evidence is an operator receipt, not an automatic live verification.");
add("get", "", "List capability evidence after a revision", { query: revisions });
add("post", "", "Append a manual capability evidence receipt", { body: appendCapabilityEvidenceSchema });
add = group("/companies/{companyId}/cost-routing", "cost-routing-preview", "board",
  "Company board administrator (local implicit board, instance administrator, or users:manage_permissions) only. Preview does not dispatch an agent or authorize a runtime policy.");
add("get", "/policy", "Read the cost routing preview policy");
add("post", "/policy", "Save the cost routing preview policy", { body: saveRoutingPolicySchema });
add("post", "/previews", "Create an idempotent cost routing preview", { body: createRoutingPreviewSchema });
add("get", "/previews/{id}", "Read a cost routing preview");
add = group("/companies/{companyId}", "setup-access", "board",
  "Board and company access required. This read-only capability hint does not authorize a subsequent mutation.");
add("get", "/setup-capabilities", "Read the current board user's setup capabilities");
add = group("/admin/users/{userId}/auth-revocations", "auth-revocations", "instance_admin_session",
  "Instance administrator browser session only; hidden instance.access administration remains operator-managed. Revokes existing local sessions and personal board keys, not membership, IdP access or running work.");
add("get", "", "Read local authentication revocations");
add("post", "", "Revoke existing local user authentication idempotently", { body: revokeLocalAuthSchema });

add = group("/companies/{companyId}/notifications", "notifications", "board");
add("get", "", "Read notification configuration and recent deliveries");
add("post", "/endpoints", "Create a disabled notification endpoint", { body: body.notificationEndpointSchema, success: [201] });
add("patch", "/endpoints/{id}", "Toggle an exact notification configuration version", { body: body.notificationToggleSchema });
add("get", "/endpoints/{id}/revisions", "Read notification configuration history");
add("post", "/endpoints/{id}/revisions", "Revise and pause a notification endpoint", { body: body.notificationRevisionSchema });
add("get", "/endpoints/{id}/verification", "Read notification verification context");
add("get", "/endpoints/{id}/verification/evidence", "List manual notification evidence", { query: revisions });
add("post", "/endpoints/{id}/verification/evidence", "Append manual notification evidence", { body: appendNotificationEvidenceSchema });
add("post", "/endpoints/{id}/test", "Queue one explicit notification test", { body: body.notificationTestSchema, success: [202] });
add("post", "/subscriptions", "Create or update a notification subscription", { body: body.notificationSubscriptionSchema, success: [201] });
add("patch", "/subscriptions/{id}", "Toggle a notification subscription", { body: body.notificationEnabledSchema });
add("patch", "/subscriptions/{id}/policy", "Revise policy for new notification events", { body: notificationPolicyUpdateSchema });
add("get", "/deliveries/{id}/reviews", "Read manual delivery reconciliation history");
add("post", "/deliveries/{id}/reviews", "Record a manual delivery review without changing transport outcome", { body: body.notificationReviewSchema });
add("get", "/deliveries/{id}/preview", "Read a redacted frozen delivery preview");
add("post", "/deliveries/{id}/retry", "Queue an explicitly reviewed delivery retry", { body: body.notificationRetrySchema, success: [202] });

add = group("/companies/{companyId}/coding", "coding", "board",
  `${companyAdmin} Delivery and task privacy are checked. Fixed commit and review gates still apply; no response grants production release authority.`);
add("get", "", "List readable coding deliveries", { query: codingListQuerySchema });
add("post", "", "Create a coding delivery from the actual workspace", { body: body.codingCreateSchema, success: [201] });
add("get", "/tasks/{issueId}/goal", "Read a coding task's planning goal");
add("put", "/tasks/{issueId}/goal", "Save a coding planning goal without dispatching work", { body: saveCodingGoalSchema });
add("post", "/{id}/repair-settings", "Confirm bounded coding repair authorization", { body: repairSettingsSchema, auth: "session", description: humanAdmin });
for (const [suffix, summary] of [["repairs", "Read bounded coding repair history"], ["build-matrix", "Read coding build matrix"], ["diff", "Read the fixed-head coding diff"]]) add("get", `/{id}/${suffix}`, summary);
add("post", "/{id}/evidence", "Record checks for a fixed coding commit", { body: body.codingEvidenceSchema });
add("post", "/{id}/artifacts", "Inspect and record local artifact metadata", { body: body.codingArtifactsSchema });
add("post", "/{id}/review", "Confirm a fixed coding diff review", { body: body.codingReviewSchema, auth: "session", description: humanAdmin });
add("post", "/{id}/publish", "Publish the confirmed coding work branch", { body: body.codingConfirmSchema });
add("post", "/{id}/merge-request", "Create a merge request for a fixed coding commit", { body: body.codingConfirmSchema });
add("post", "/{id}/sync", "Read current merge request and CI evidence");
add = group("/companies/{companyId}/coding/{id}/build-observations", "build-observations", "session", humanAdmin);
add("get", "/context", "Read build observation authorization context");
add("get", "/requests/current", "Read the current owned build observation request");
add("get", "/requests/{requestId}", "Read an owned build observation request");
add("get", "", "Read build observation history", { query: z.object({ cursor: uuid.optional() }).strict() });
add("post", "", "Start one explicit bounded build observation", { body: startMimouseBuildObservationSchema, success: [200, 202] });
add("post", "/requests/{requestId}/close-unknown", "Record an explicit unknown observation closure", { body: closeMimouseBuildObservationSchema });

add = group("/companies/{companyId}/feedback-inbox", "feedback-inbox", "board");
add("get", "", "List redacted feedback candidates", { query: list });
add("post", "", "Import quarantined feedback evidence idempotently", { body: feedbackImportSchema, success: [200, 201] });
add("get", "/{id}", "Read a redacted feedback candidate");
add("get", "/{id}/candidates", "Read potential related feedback without merging");
add("get", "/{id}/evidence", "Read feedback evidence history", { query: page });
for (const [suffix, summary] of [["run-log-source", "Read the authorized run-log source"], ["verification-options", "Read human feedback verification options"], ["verifications", "Read human feedback verification history"], ["promotion", "Read the current user's feedback promotion receipt"]]) add("get", `/{id}/${suffix}`, summary, { auth: "session", description: humanAdmin });
for (const [suffix, schema, summary] of [
  ["run-log-preview", feedbackRunLogSelectionSchema, "Preview authorized local run-log feedback"],
  ["run-log-import", feedbackRunLogImportSchema, "Import authorized local run-log feedback"],
  ["{id}/verification-preview", feedbackVerificationPreviewSchema, "Preview a human feedback verification"],
  ["{id}/verifications", feedbackVerificationConfirmSchema, "Confirm a human feedback verification"],
  ["{id}/promote", feedbackPromotionSchema, "Confirm one private feedback task without dispatch"],
] as const) add("post", `/${suffix}`, summary, { body: schema, auth: "session", description: humanAdmin, ...(suffix === "run-log-import" ? { success: [200, 201] } : {}) });

add = group("/companies/{companyId}/data-operations", "data-operations", "board",
  `${companyAdmin} Preview and approval request only; no target apply/write endpoint is implemented.`);
add("get", "", "List data operation previews", { query: list });
add("post", "", "Create a bounded data operation preview", { body: createOperationPreviewSchema, success: [200, 201] });
add("get", "/{id}", "Read a data operation preview");
add("get", "/{id}/readiness", "Read data operation readiness blockers");
add("post", "/{id}/request-approval", "Request human data operation review", { body: requestOperationApprovalSchema, auth: "session", description: humanAdmin });
add = group("/companies/{companyId}/research-candidates", "research-candidates", "board");
add("get", "", "List quarantined research candidates", { query: list });
add("post", "", "Create a research candidate idempotently", { body: researchCandidateSchema, success: [200, 201] });
add("get", "/{id}", "Read a research candidate");
add("get", "/{id}/promotion", "Read the current user's research promotion receipt", { auth: "session", description: humanAdmin });
add("post", "/{id}/promote", "Confirm a bounded research task scope", { body: researchPromotionSchema, auth: "session", description: humanAdmin });

add = group("/companies/{companyId}/skill-evaluations", "skill-evaluations", "board",
  `${companyAdmin} This API compares fixed evidence without running a model or changing skill files. Datasets containing feedback provenance additionally require a signed-in human reviewer.`);
add("post", "/datasets/feedback-preview", "Preview feedback provenance for a fixed evaluation input", { body: previewEvaluationFeedbackSchema, auth: "session", description: humanAdmin });
add("get", "/datasets", "List fixed evaluation datasets", { query: page });
add("post", "/datasets", "Create a fixed evaluation dataset", { body: createEvaluationDatasetSchema, success: [200, 201] });
add("get", "/comparisons", "List fixed evaluation comparisons", { query: page });
add("post", "/comparisons", "Compare recorded evidence without executing a skill", { body: createEvaluationComparisonSchema, success: [200, 201] });
add("get", "/comparisons/{id}", "Read a fixed evaluation comparison");
add("get", "/skills/{skillId}/evidence", "Read recorded skill evidence");
add("get", "/readiness", "Read comparison-only capability boundaries");
add = group("/companies/{companyId}/skill-evaluations/restores", "evaluation-restores", "session", humanAdmin);
add("get", "", "List owned controlled evaluation restores");
add("get", "/readiness/{reportId}", "Read report-specific human restore readiness");
add("get", "/{id}", "Read an owned controlled evaluation restore");
add("post", "", "Prepare a controlled restore of a paused unused managed skill", { body: createEvaluationRestoreSchema, success: [200, 201, 202] });
add("post", "/{id}/recover", "Recover the same controlled evaluation restore", { body: recoverEvaluationRestoreSchema, success: [200, 202] });

add = group("/companies/{companyId}/feedback-langfuse/pulls", "feedback-langfuse", "board");
add("get", "", "List configured bounded Langfuse pulls");
add("post", "", "Create a fixed-window Langfuse pull configuration", { body: langfuseCreateSchema, success: [201] });
add("post", "/{id}/restart", "Confirm a Langfuse pull restart", { body: confirmed });
add("post", "/{id}/pull", "Pull one bounded Langfuse observation page", { body: z.object({}).strict(), bodyOptional: true });
add = group("/companies/{companyId}/feedback-wecom/connections", "feedback-wecom", "board");
add("get", "", "List company WeCom feedback connections");
add("post", "", "Register a disabled WeCom feedback connection", { body: wecomConfigSchema, success: [201], authorization: { instanceAdmin: true } });
add("post", "/{id}/enabled", "Explicitly toggle WeCom feedback ingestion", { body: z.object({ enabled: z.boolean(), confirm: z.literal(true) }).strict() });
add("patch", "/{id}", "Explicitly revise WeCom feedback configuration", { body: z.object({ config: wecomConfigSchema, confirm: z.literal(true) }).strict() });

add = group("/companies/{companyId}/prompt-registry", "prompt-registry", "session", humanAdmin);
add("get", "", "List owned private prompt identities", { query: page });
add("post", "/revisions", "Create an immutable private prompt revision", { body: createPromptRevisionSchema, success: [200, 201] });
for (const kind of ["revisions", "receipts"]) add("get", `/{promptId}/${kind}`, `List private prompt ${kind}`, { query: page });
add("get", "/{promptId}/revisions/{revisionId}", "Read an owned private prompt revision");
add("post", "/{promptId}/selections", "Record an owned prompt revision selection", { body: selectPromptRevisionSchema, success: [200, 201] });
add("get", "/test-capabilities", "Read private prompt test deployment capabilities");
add("post", "/{promptId}/comparison", "Compare explicit private prompt test receipts without execution", { body: comparePrivatePromptTestsSchema });
add("post", "/{promptId}/tests", "Prepare an isolated private prompt test", { body: preparePrivatePromptTestSchema, success: [200, 201] });
add("post", "/{promptId}/tests/{testId}/execute", "Explicitly execute a prepared private prompt test", { body: executePrivatePromptTestSchema });
add("post", "/{promptId}/tests/{testId}/cancel", "Cancel an owned private prompt test", { body: cancelPrivatePromptTestSchema });
add("get", "/{promptId}/tests", "List owned private prompt tests", { query: page });
add("get", "/{promptId}/tests/{testId}", "Read an owned private prompt test receipt");
add = group("/companies/{companyId}/prompt-applications", "prompt-applications", "session", humanAdmin);
add("get", "/agents/{agentId}/head", "Read an agent's current prompt application head");
add = group("/companies/{companyId}/prompt-registry/{promptId}/applications", "prompt-applications", "session", humanAdmin);
add("get", "", "List owned prompt applications", { query: page });
add("get", "/requests/{requestId}", "Read an owned idempotent prompt application request", { query: promptApplicationRequestQuerySchema });
add("get", "/{applicationId}", "Read an owned prompt application");
add("get", "/{applicationId}/dispatches", "Read owned prompt application dispatch history", { query: page });
add("post", "", "Prepare a prompt application for human approval", { body: preparePromptApplicationSchema, success: [200, 201] });
add("post", "/{applicationId}/approve", "Approve an exact prepared prompt application", { body: approvePromptApplicationSchema });
add("post", "/{applicationId}/rollback", "Confirm rollback of an owned prompt application", { body: rollbackPromptApplicationSchema });

add = group("/companies/{companyId}/runtime-cost-routing", "runtime-cost-routing", "session", humanAdmin);
add("get", "", "Read current runtime routing context");
add("get", "/policies/{id}", "Read an owned runtime routing policy");
add("get", "/bindings/{id}", "Read an owned runtime routing task binding");
add("get", "/requests/{requestId}", "Read an owned idempotent runtime routing request", { query: runtimeRoutingRequestQuerySchema });
add("post", "/prepare", "Prepare a bounded runtime routing policy", { body: prepareRuntimeRoutingPolicySchema, success: [200, 201] });
add("post", "/policies/{id}/approve", "Approve an exact runtime routing policy", { body: approveRuntimeRoutingPolicySchema });
add("post", "/policies/{id}/close-expired", "Close an expired runtime policy request", { body: closeExpiredRuntimeRoutingPolicySchema });
add("post", "/disable", "Explicitly disable runtime cost routing", { body: disableRuntimeRoutingPolicySchema });
add("post", "/tasks", "Create an explicitly bounded runtime routing task", { body: createRuntimeRoutingTaskSchema, success: [200, 201] });
add("post", "/bindings/{id}/run", "Explicitly request one bound runtime routing run", { body: runRuntimeRoutingTaskSchema });
add = group("/companies/{companyId}/research-routines", "research-routines", "session", humanAdmin);
add("get", "", "List research routine bindings with current source visibility");
add("get", "/available", "List company-open routines available for research");
add("get", "/{routineId}/history", "Read authorized research routine history", { query: researchHistoryQuerySchema });
add("put", "/{routineId}", "Bind a company-open research routine without starting it", { body: researchRoutineBindingSchema });
add("post", "/{routineId}/reports", "Submit quarantined evidence from the matching active routine run", { body: researchRoutineReportSchema, success: [200, 201], auth: "agent_run", description: "Requires a signed run-bound agent JWT, an enabled matching research binding, the actual routine/issue/heartbeat identity, current task write access and a company-open source boundary. Board sessions and bare agent keys are rejected." });

add = group("/companies/{companyId}/integrations/workbuddy", "workbuddy", "board",
  "Signed-in connection owner with company access required. Durable provider credentials are never returned; disconnecting a connection does not prove remote work stopped.");
add("get", "", "Read the current owner's WorkBuddy connections and jobs");
add("post", "/authorize", "Begin session-bound WorkBuddy authorization", { auth: "session", description: "Requires the signed-in connection owner and a browser session; deployment must enable WorkBuddy. OAuth state binds company, user and session." });
add("get", "/callback", "Complete session-bound WorkBuddy authorization", { auth: "session", query: z.object({ state: z.string().max(256), code: z.string().max(4096) }), success: [302], redirect: true });
add("post", "/connections/{id}/disconnect", "Disconnect the current owner's WorkBuddy connection");
add("post", "/connections/{id}/agents", "Confirm company agents permitted to use an owned WorkBuddy connection", { body: body.workbuddyAgentsSchema });
const ownerOrRun = "Requires a signed-in board owner or a valid active agent JWT/run with the responsible owner and connection agent grant. Bare agent API keys and unrelated company/owner identities are rejected. Deployment must enable WorkBuddy; uncertain remote creation is not blindly retried.";
add("post", "/jobs", "Explicitly create one WorkBuddy job", { body: body.workbuddyCreateSchema, success: [202], auth: "owner_or_run", description: ownerOrRun });
add("post", "/jobs/{id}/refresh", "Refresh the same owned WorkBuddy job without recreating it", { auth: "owner_or_run", description: ownerOrRun });
add("post", "/jobs/{id}/prompt", "Explicitly send one new turn to an owned WorkBuddy job", { body: body.workbuddyPromptSchema, auth: "owner_or_run", description: ownerOrRun });

// Named path IDs are UUIDs except Better Auth's opaque userId. The handlers
// remain authoritative for validation status codes and additional refinements.
export const mimouseOpenApiOperations: readonly MimouseOpenApiOperation[] = operations.map(operation => ({
  ...operation,
  params: z.object(Object.fromEntries([...operation.path.matchAll(/\{([^}]+)\}/g)].map(([, name]) => [name, name === "userId" ? z.string() : uuid]))),
}));
export const mimouseOpenApiByOperation = new Map(mimouseOpenApiOperations.map(operation => [`${operation.method.toUpperCase()} ${operation.path}`, operation]));

export function mimouseOpenApiSecurity(operation: MimouseOpenApiOperation) {
  const session = { BoardSessionAuth: [] as string[] };
  const boardKey = { BoardApiKeyAuth: [] as string[] };
  const run = { AgentRunAuth: [] as string[] };
  const security = operation.auth === "agent_run" ? [run] : operation.auth === "owner_or_run" ? [session, boardKey, run]
    : operation.auth === "session" || operation.auth === "instance_admin_session" ? [session] : [session, boardKey];
  const authorization = operation.auth === "agent_run" ? { actor: "agent", heartbeatBound: true, taskBound: true }
    : operation.auth === "owner_or_run" ? { actor: "board_or_agent", responsibleOwnerRequired: true, agentRunBound: true }
      : { actor: "board", ...(operation.auth === "session" || operation.auth === "instance_admin_session" ? { sessionBound: true } : {}),
          ...(operation.auth === "instance_admin_session" ? { instanceAdmin: true } : {}) };
  return { security, authorization: { ...authorization, ...operation.authorization } };
}
