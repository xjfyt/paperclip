import { createHash } from "node:crypto";
export const type = "workbuddy";
export const label = "WorkBuddy";
export function createServerAdapter() {
  return {
    type, supportsLocalAgentJwt: true,
    sessionCodec: { deserialize: value => value && typeof value.requestKey === "string" && typeof value.companyId === "string" && typeof value.connectionId === "string" ? { ...(typeof value.jobId === "string" ? { jobId: value.jobId } : {}), requestKey: value.requestKey, companyId: value.companyId, connectionId: value.connectionId } : null, serialize: value => value, getDisplayId: value => value?.jobId ?? null },
    getConfigSchema: () => ({ fields: [{ key: "connectionId", label: "Owner-authorized WorkBuddy connection ID", type: "text", required: true }] }),
    testEnvironment: async ctx => ({ adapterType: type, status: "warn", testedAt: new Date().toISOString(), checks: [{ code: "workbuddy_live_unverified", level: "warn", message: ctx.config.connectionId ? "Verify OAuth owner, delegated Agent permission and real cloud-task behavior before use." : "Configure an owner-authorized connection ID." }] }),
    execute: ctx => execute(ctx),
  };
}
export async function execute(ctx, transport = fetch) {
  const failure = (code, message) => ({ exitCode: 1, signal: null, timedOut: false, errorCode: code, errorMessage: message });
  if (!ctx.authToken || !ctx.config.connectionId) return failure("workbuddy_configuration_missing", "Run token and owner-authorized connection are required.");
  const raw = process.env.PAPERCLIP_API_URL;
  if (!raw) return failure("paperclip_api_url_missing", "Server API URL is required.");
  const base = new URL(raw);
  if (!["https:", "http:"].includes(base.protocol) || base.username || base.password || base.search || base.hash) return failure("paperclip_api_url_invalid", "Server API URL is invalid.");
  if (ctx.signal?.aborted) return failure("workbuddy_cancelled_before_dispatch", "Cancelled before dispatch.");
  const taskKey = ctx.runtime.taskKey || ctx.context.taskId || ctx.context.issueId;
  if (!taskKey) return failure("workbuddy_task_context_required", "A stable task identity is required for retry-safe remote creation.");
  const prompt = ctx.context.prompt || ctx.config.promptTemplate || `Research Paperclip task ${taskKey} and provide a report.`;
  const identity = createHash("sha256").update(JSON.stringify([ctx.agent.companyId, ctx.agent.id, taskKey, ctx.context.paperclipWorkspace?.workspaceId ?? ctx.context.paperclipWorkspace?.cwd ?? null, ctx.config.connectionId, ctx.config.requestEpoch ?? "1", prompt])).digest("hex");
  const requestKey = `${identity.slice(0,8)}-${identity.slice(8,12)}-5${identity.slice(13,16)}-a${identity.slice(17,20)}-${identity.slice(20,32)}`;
  const stableSession = { requestKey, companyId: ctx.agent.companyId, connectionId: ctx.config.connectionId };
  const prior = ctx.runtime.sessionParams;
  if (prior && (prior.companyId !== ctx.agent.companyId || prior.connectionId !== ctx.config.connectionId || prior.requestKey !== requestKey)) return failure("workbuddy_session_identity_mismatch", "Session belongs to another company or account connection.");
  async function call(path, body) {
    const response = await transport(new URL(`/api/companies/${ctx.agent.companyId}/integrations/workbuddy${path}`, base), { method: "POST", headers: { authorization: `Bearer ${ctx.authToken}`, "content-type": "application/json" }, body: JSON.stringify(body), redirect: "error", signal: AbortSignal.any([AbortSignal.timeout(20000), ...(ctx.signal ? [ctx.signal] : [])]) });
    if (!response.ok) throw Error(`workbuddy_api_${response.status}`);
    return response.json();
  }
  try {
    let job;
    if (prior?.jobId) job = await call(`/jobs/${encodeURIComponent(prior.jobId)}/refresh`, {});
    else {
      ctx.onDispatch?.();
      job = await call("/jobs", { connectionId: ctx.config.connectionId, requestKey, prompt, confirmRemoteExecution: true });
    }
    const sessionParams = { ...stableSession, jobId: job.id };
    // A remote create receipt is not a report, and an ended prompt is not a
    // completed business task. No strong cancellation claim is made.
    const complete = job.remoteState === "completed" && job.lastCode == null && typeof job.report === "string" && job.report.trim();
    await ctx.onLog("stdout", JSON.stringify({ providerJobId: job.providerJobId ?? null, remoteState: job.remoteState, dispatchState: job.dispatchState }) + "\n");
    return { exitCode: complete ? 0 : 1, signal: null, timedOut: false, sessionParams, sessionDisplayId: job.providerJobId ?? job.id, provider: "workbuddy", costStatus: "unpriced", costUsd: null,
      summary: complete ? job.report : "Remote task remains pending or requires reconciliation; resume queries this same durable job.",
      resultJson: { jobId: job.id, remoteState: job.remoteState, providerCompleted: Boolean(complete), businessCompleted: false, cancellationConfirmed: false },
      ...(!complete ? { errorCode: job.dispatchState === "indeterminate" ? "workbuddy_creation_unconfirmed" : "workbuddy_remote_pending" } : {}),
    };
  } catch { return { ...failure("workbuddy_transport_unconfirmed", "Inspect the durable server ledger before retrying; remote cancellation is not confirmed."), sessionParams: stableSession }; }
}
