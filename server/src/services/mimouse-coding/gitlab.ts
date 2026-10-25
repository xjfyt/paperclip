export class GitLabError extends Error { constructor(public code: string, public uncertain = false) { super(code); } }
export interface GitLabMergeRequest { iid: number; sha: string; state: string; web_url?: string; source_branch?: string; target_branch?: string }
export interface GitLabPipeline { id: number; sha: string; status: string; web_url?: string }
// Persist only the fields used by the release-candidate gate, never raw vendor payloads.
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new GitLabError("gitlab_invalid_receipt");
  return value as Record<string, unknown>;
}
function positiveId(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) throw new GitLabError("gitlab_invalid_receipt");
  return value;
}
function shaValue(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{40}$/.test(value)) throw new GitLabError("gitlab_invalid_receipt");
  return value;
}
function safeWebUrl(value: unknown, origin: string): string | undefined {
  if (typeof value !== "string") return undefined;
  try { const url = new URL(value); return url.origin === origin && !url.username && !url.password && !url.search && !url.hash ? url.href : undefined; } catch { return undefined; }
}
export function mergeRequestReceipt(value: unknown, origin: string): GitLabMergeRequest {
  const row = record(value);
  if (typeof row.state !== "string" || !["opened", "closed", "merged", "locked"].includes(row.state)) throw new GitLabError("gitlab_invalid_receipt");
  return { iid: positiveId(row.iid), sha: shaValue(row.sha), state: row.state,
    web_url: safeWebUrl(row.web_url, origin),
    ...(typeof row.source_branch === "string" ? { source_branch: row.source_branch } : {}),
    ...(typeof row.target_branch === "string" ? { target_branch: row.target_branch } : {}) };
}
export function pipelineReceipt(value: unknown, origin: string): GitLabPipeline {
  const row = record(value);
  if (typeof row.status !== "string" || row.status.length > 40) throw new GitLabError("gitlab_invalid_receipt");
  return { id: positiveId(row.id), sha: shaValue(row.sha), status: row.status, web_url: safeWebUrl(row.web_url, origin) };
}
export function gitlabOrigin(raw: string, allowedOrigins: readonly string[]): string {
  let url: URL; try { url = new URL(raw); } catch { throw new GitLabError("invalid_gitlab_url"); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash || !allowedOrigins.includes(url.origin)) throw new GitLabError("gitlab_origin_not_allowed");
  return url.origin;
}
export function gitlabClient(config: { origin: string; projectId: number; token: string; allowedOrigins: readonly string[] }, transport: typeof fetch = fetch) {
  const origin = gitlabOrigin(config.origin, config.allowedOrigins);
  if (!Number.isSafeInteger(config.projectId) || config.projectId <= 0) throw new GitLabError("invalid_project_id");
  async function call<T>(path: string, method = "GET", body?: unknown, page = 1): Promise<T> {
    let response: Response;
    try { response = await transport(`${origin}/api/v4${path}`, { method, headers: { "PRIVATE-TOKEN": config.token, ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), redirect: "error", signal: AbortSignal.timeout(15000) }); }
    catch { throw new GitLabError("gitlab_transport_unconfirmed", method !== "GET"); }
    if (!response.ok) throw new GitLabError(`gitlab_http_${response.status}`, method !== "GET" && response.status >= 500);
    const reader = response.body?.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
    if (reader) for (;;) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.length; if (bytes > 2 * 1024 * 1024) { await reader.cancel(); throw new GitLabError("gitlab_response_too_large", method !== "GET"); } chunks.push(chunk.value); }
    let parsed: unknown;
    try { parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new GitLabError("gitlab_invalid_response", method !== "GET"); }
    const next = Number(response.headers.get("x-next-page"));
    if (Array.isArray(parsed) && method === "GET" && next > 0) {
      if (!Number.isSafeInteger(next) || next <= page || next > 10) throw new GitLabError("gitlab_pagination_requires_review");
      const nextUrl = new URL(path, "https://placeholder.invalid"); nextUrl.searchParams.set("page", String(next));
      const rest = await call<unknown[]>(nextUrl.pathname + nextUrl.search, method, undefined, next);
      if (!Array.isArray(rest)) throw new GitLabError("gitlab_invalid_page");
      return [...parsed, ...rest] as T;
    }
    return parsed as T;
  }
  const project = `/projects/${config.projectId}`;
  return {
    async capabilities() {
      let version: string | null = null;
      try { version = (await call<{ version?: string }>("/version")).version ?? null; } catch { /* Unknown is not unsupported or successful. */ }
      return { version, mergeRequests: "probe_on_use", pipelines: "probe_on_use", advancedApprovals: "unknown", syntheticMergePipelines: "unsupported" };
    },
    project: () => call<{ id: number; http_url_to_repo: string; ssh_url_to_repo: string; default_branch: string }>(project),
    branch: (name: string) => call<{ name: string; commit: { id: string }; protected: boolean }>(`${project}/repository/branches/${encodeURIComponent(name)}`),
    mergeRequest: async (iid: number) => mergeRequestReceipt(await call(`${project}/merge_requests/${positiveId(iid)}`), origin),
    listMergeRequests: async (source: string, target: string) => (await call<unknown[]>(`${project}/merge_requests?state=opened&source_branch=${encodeURIComponent(source)}&target_branch=${encodeURIComponent(target)}&per_page=100`)).map(row => mergeRequestReceipt(row, origin)),
    createMergeRequest: async (source: string, target: string, title: string) => {
      const value = await call(`${project}/merge_requests`, "POST", { source_branch: source, target_branch: target, title, remove_source_branch: false });
      try { return mergeRequestReceipt(value, origin); } catch { throw new GitLabError("gitlab_invalid_creation_receipt", true); }
    },
    pipeline: async (id: number) => pipelineReceipt(await call(`${project}/pipelines/${positiveId(id)}`), origin),
    pipelines: async (sha: string) => (await call<unknown[]>(`${project}/pipelines?sha=${encodeURIComponent(sha)}&per_page=100`)).map(row => pipelineReceipt(row, origin)),
    jobs: (pipelineId: number) => call<Array<{ id: number; status: string; name: string; web_url?: string; commit?: { id?: string } }>>(`${project}/pipelines/${pipelineId}/jobs?per_page=100`),
  };
}
export interface CheckEvidence { commitSha: string; command: string; exitCode: number | null; startedAt: string; finishedAt: string; logRef: string; status: "passed" | "failed" | "blocked" | "not_run" }
export function deliveryGate(input: { headSha: string; reviewedSha: string | null; mr: GitLabMergeRequest | null; pipeline: GitLabPipeline | null; evidence: CheckEvidence[] }) {
  const blockers: string[] = [];
  if (!/^[a-f0-9]{40}$/.test(input.headSha)) blockers.push("invalid_head_sha");
  if (input.reviewedSha !== input.headSha) blockers.push("review_stale_or_missing");
  if (!input.mr || input.mr.sha !== input.headSha || input.mr.state !== "opened") blockers.push("mr_head_not_verified");
  if (!input.pipeline || input.pipeline.sha !== input.headSha || input.pipeline.status !== "success") blockers.push("ci_not_verified_for_head");
  if (!input.evidence.length || input.evidence.some(item => item.commitSha !== input.headSha || item.status !== "passed" || item.exitCode !== 0 || !item.command.trim() || !item.logRef.trim() || !Number.isFinite(Date.parse(item.startedAt)) || !Number.isFinite(Date.parse(item.finishedAt)) || Date.parse(item.finishedAt) < Date.parse(item.startedAt))) blockers.push("test_evidence_incomplete");
  return { readyForReleaseCandidate: blockers.length === 0, blockers, productionReleaseAuthorized: false as const };
}
export function repairDecision(input: { attempts: number; remainingBudgetCents: number; elapsedMs: number; maxDurationMs: number; fingerprint: string; previousFingerprint: string | null; environmentAvailable: boolean }) {
  if (!input.environmentAvailable) return { action: "human" as const, reason: "environment_blocked" };
  if (input.attempts >= 2 || input.remainingBudgetCents <= 0 || input.elapsedMs >= input.maxDurationMs) return { action: "human" as const, reason: "repair_limit" };
  if (input.fingerprint === input.previousFingerprint) return { action: "human" as const, reason: "repeated_failure" };
  return { action: "repair" as const, nextAttempt: input.attempts + 1 };
}
