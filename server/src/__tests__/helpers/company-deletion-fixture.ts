import { randomUUID } from "node:crypto";
import { is, SQL, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";

const hash = "a".repeat(64), sha = "a".repeat(40);
const json = (value: unknown) => sql`${JSON.stringify(value)}::jsonb`;

/** Synthetic FK witnesses, not evidence of provider/model execution. */
export async function seedCompanyDeletionGraph(db: Db, prefix: string) {
  const companyId = randomUUID(), tables = new Set<string>(), secretVersionIds: string[] = [];
  async function insert(table: string, values: Record<string, unknown>, hasId = true) {
    const row: Record<string, unknown> = hasId ? { id: randomUUID(), ...values } : values;
    if (row.company_id === companyId || table === "companies") tables.add(table);
    await db.execute(sql`insert into ${sql.identifier(table)}
      (${sql.join(Object.keys(row).map(key => sql.identifier(key)), sql`, `)})
      values (${sql.join(Object.values(row).map(value => is(value, SQL) ? value : sql`${value}`), sql`, `)})`);
    return String(row.id ?? "");
  }
  const scoped = (values: Record<string, unknown>) => ({ company_id: companyId, ...values });
  const request = () => ({ request_id: randomUUID(), request_digest: hash });
  const actor = { actor_user_id: "synthetic-owner", actor_session_id: "synthetic-session" };
  await insert("companies", { id: companyId, name: `Synthetic deletion ${prefix}`, issue_prefix: prefix });
  const agentId = await insert("agents", scoped({ name: "Synthetic terminated agent", adapter_type: "process",
    lifecycle_state: "terminated", status: "terminated" }));
  const projectId = await insert("projects", scoped({ name: "Synthetic project" }));
  const issueId = await insert("issues", scoped({ title: "Synthetic private issue", visibility: "private",
    created_by_user_id: "synthetic-owner", status: "done" }));
  const workspaceId = await insert("execution_workspaces", scoped({ project_id: projectId, mode: "isolated",
    strategy_type: "git_worktree", name: "Synthetic workspace", cwd: "/tmp/nonexistent-company-delete-fixture" }));
  const wakeId = await insert("agent_wakeup_requests", scoped({ agent_id: agentId, source: "on_demand", status: "completed" }));
  const runId = await insert("heartbeat_runs", scoped({ agent_id: agentId, issue_id: issueId, scope_kind: "issue",
    wakeup_request_id: wakeId, status: "succeeded" }));
  const secretId = await insert("company_secrets", scoped({ key: "synthetic", name: "Synthetic secret" }));
  secretVersionIds.push(await insert("company_secret_versions", { secret_id: secretId, version: 1,
    material: json({ inert: true }), value_sha256: hash, fingerprint_sha256: hash }));
  const routineId = await insert("routines", scoped({ title: "Synthetic repair" }));
  const routineRevisionId = await insert("routine_revisions", scoped({ routine_id: routineId, revision_number: 1,
    title: "Synthetic repair", snapshot: json({}) }));
  const routineRunId = await insert("routine_runs", scoped({ routine_id: routineId, routine_revision_id: routineRevisionId,
    source: "manual", status: "completed", linked_issue_id: issueId }));
  const deliveryId = await insert("mimouse_coding_deliveries", scoped({ issue_id: issueId, workspace_id: workspaceId,
    gitlab_origin: "https://fixture.invalid", project_id: 1, secret_ref: secretId, base_sha: sha, head_sha: sha,
    source_branch: "fixture", target_branch: "main" }));
  await insert("mimouse_coding_repair_attempts", scoped({ delivery_id: deliveryId, attempt: 1, pipeline_id: 1,
    head_sha: sha, fingerprint: hash, routine_id: routineId, routine_revision_id: routineRevisionId,
    routine_run_id: routineRunId, issue_id: issueId, request_key: "synthetic", snapshot: json({}) }));
  const feedbackId = await insert("mimouse_feedback_inbox", scoped({ source_kind: "manual", source_instance: "synthetic",
    external_id: "synthetic", content_digest: hash, candidate_key: "synthetic", title: "Synthetic failure", body: "Synthetic body",
    product: "fixture", software_version: "1", occurred_at: sql`now()`, actor_id: "synthetic-owner", redacted: true }));
  await insert("mimouse_feedback_promotions", scoped({ ...request(), feedback_id: feedbackId, issue_id: issueId,
    actor_user_id: "synthetic-owner", review: json({}) }));
  await insert("mimouse_feedback_verifications", scoped({ ...request(), feedback_id: feedbackId, issue_id: issueId,
    reproduction_delivery_id: deliveryId, regression_delivery_id: deliveryId, preview_digest: hash,
    actor_user_id: "synthetic-owner", snapshot: json({}) }));
  const observationId = randomUUID();
  await insert("mimouse_coding_build_observation_requests", scoped({ request_id: observationId, request_digest: hash,
    delivery_id: deliveryId, snapshot_digest: hash, profile_id: "fixture", job_id: 1, state: "terminal",
    retry_until: sql`now() + interval '1 hour'`, ...actor }));
  await insert("mimouse_coding_build_observation_receipts", scoped({ request_id: observationId, delivery_id: deliveryId,
    status: "blocked", diagnostic: "fixture_only", snapshot_digest: hash, result: json({ admission: "blocked" }) }));

  const skillId = await insert("company_skills", scoped({ key: "fixture", slug: "fixture", name: "Synthetic skill", markdown: "Synthetic" }));
  const versionId = await insert("company_skill_versions", scoped({ company_skill_id: skillId, revision_number: 1 }));
  const datasetId = await insert("mimouse_evaluation_datasets", scoped({ ...request(), skill_id: skillId, name: "Synthetic dataset",
    cases: json([]), dataset_hash: hash, actor_id: "synthetic-owner" }));
  const comparisonId = await insert("mimouse_evaluation_comparisons", scoped({ ...request(), dataset_id: datasetId,
    baseline_version_id: versionId, candidate_version_id: versionId, report: json({}), evidence_snapshot: json({}), actor_id: "synthetic-owner" }));
  await insert("mimouse_evaluation_restores", scoped({ ...request(), skill_id: skillId, report_id: comparisonId, action: "activate",
    before_version_id: versionId, target_version_id: versionId, before_hash: hash, target_hash: hash, operation_hash: hash,
    before_name: "Synthetic", target_name: "Synthetic", source_directory: "/tmp/nonexistent-company-delete-fixture", actor_user_id: "synthetic-owner" }));
  const promptId = await insert("mimouse_prompts", scoped({ prompt_key: "synthetic" }));
  const revisionId = await insert("mimouse_prompt_revisions", scoped({ ...request(), prompt_id: promptId, content: "Synthetic private prompt",
    content_hash: hash, actor_user_id: "synthetic-owner" }));
  const receiptId = await insert("mimouse_prompt_receipts", scoped({ ...request(), prompt_id: promptId, action: "promote",
    selected_revision_id: revisionId, actor_user_id: "synthetic-owner" }));
  // Rollback chain exercises self-FKs, while the mutable head retains its receipt.
  const rollbackId = await insert("mimouse_prompt_receipts", scoped({ ...request(), prompt_id: promptId, action: "rollback",
    previous_receipt_id: receiptId, rollback_of_receipt_id: receiptId, before_revision_id: revisionId, actor_user_id: "synthetic-owner" }));
  await db.execute(sql`update mimouse_prompts set selected_revision_id = ${revisionId}, head_receipt_id = ${rollbackId}
    where company_id = ${companyId} and id = ${promptId}`);
  const applicationId = await insert("mimouse_prompt_applications", scoped({ ...request(), ...actor, prompt_id: promptId,
    revision_id: revisionId, revision_hash: hash, agent_id: agentId, expected_generation: 0, approval_digest: hash,
    comparison: json({}), report_hash: hash, snapshot: json({}), approval_expires_at: sql`now() + interval '1 hour'` }));
  await insert("mimouse_prompt_application_receipts", scoped({ ...request(), ...actor, agent_id: agentId, application_id: applicationId,
    action: "configure", generation: 1 }));
  await insert("mimouse_prompt_application_heads", scoped({ agent_id: agentId, application_id: applicationId,
    generation: 1, configured_at: sql`now() - interval '1 minute'` }), false);
  await insert("mimouse_prompt_application_dispatches", scoped({ agent_id: agentId, application_id: applicationId,
    run_id: runId, issue_id: issueId, generation: 1, configured_at: sql`now() - interval '1 minute'`, effective_context_hash: hash }));
  await insert("mimouse_private_prompt_tests", scoped({ ...request(), ...actor, prompt_id: promptId, revision_id: revisionId,
    head_receipt_id: receiptId, revision_hash: hash, agent_id: agentId, dataset_id: datasetId, dataset_hash: hash,
    case_id: randomUUID(), skill_version_id: versionId, config_digest: hash, skill_version_hash: hash, secret_value_hash: hash,
    status: "failed", issue_id: issueId, wakeup_request_id: wakeId, heartbeat_run_id: runId, private_result: json({ summary: "Synthetic private result" }) }));

  const candidateId = await insert("mimouse_research_candidates", scoped({ ...request(), actor_id: "synthetic-owner", evidence: json({}), evidence_hash: hash }));
  await insert("mimouse_research_promotions", scoped({ ...request(), candidate_id: candidateId, issue_id: issueId,
    actor_user_id: "synthetic-owner", evidence_hash: hash, review: json({}) }));
  await insert("mimouse_research_routine_bindings", scoped({ routine_id: routineId, product: "synthetic", configured_by_user_id: "synthetic-owner" }), false);
  const approvalId = await insert("approvals", scoped({ type: "synthetic", payload: json({}) }));
  await insert("mimouse_operation_previews", scoped({ ...request(), input_snapshot: json({}), preview: json({}),
    preview_hash: hash, actor_id: "synthetic-owner", approval_id: approvalId, approval_payload_hash: hash }));
  const endpointId = await insert("mimouse_notification_endpoints", scoped({ name: "Synthetic endpoint", kind: "wecom",
    config: json({}), secret_ref: secretId, secret_version: 1, target_key: "synthetic-global-target" }));
  const subscriptionId = await insert("mimouse_notification_subscriptions", scoped({ endpoint_id: endpointId, event_type: "run.failed" }));
  const notificationId = await insert("mimouse_notification_deliveries", scoped({ event_id: "synthetic", subscription_id: subscriptionId,
    endpoint_id: endpointId, snapshot: json({}), state: "accepted" }));
  await insert("mimouse_notification_deliveries", scoped({ event_id: "synthetic-merged", subscription_id: subscriptionId,
    endpoint_id: endpointId, snapshot: json({}), state: "merged", merged_into: notificationId }));
  await insert("mimouse_notification_reviews", scoped({ delivery_id: notificationId, request_id: randomUUID(), outcome: "unknown",
    evidence: "Synthetic", actor_id: "synthetic-owner", observed_state: "accepted", observed_attempt: 0 }));
  await insert("mimouse_notification_revisions", scoped({ endpoint_id: endpointId, config_version: 1, snapshot: json({}), actor_id: "synthetic-owner" }));
  await insert("mimouse_notification_tokens", scoped({ secret_ref: secretId, secret_version: 1, kind: "dingtalk_app", identity: "synthetic" }));
  const connectionId = await insert("mimouse_workbuddy_connections", scoped({ owner_user_id: "synthetic-owner", token_secret_ref: secretId }));
  const jobId = await insert("mimouse_workbuddy_jobs", scoped({ connection_id: connectionId, request_key: "synthetic", prompt_hash: hash }));
  await insert("mimouse_workbuddy_turns", scoped({ job_id: jobId, request_key: "synthetic", prompt_hash: hash, state: "round_finished" }));
  await insert("mimouse_wecom_connections", scoped({ bot_hash: companyId, config: json({}) }));
  await insert("mimouse_langfuse_pulls", scoped({ request_id: randomUUID(), config_digest: hash, actor_id: "synthetic-owner", config: json({}) }));

  const evidenceId = await insert("capability_evidence", scoped({ revision: 1, idempotency_key: randomUUID(), request_hash: hash,
    action: "record", receipt: json({}), reason: "synthetic", reviewer_id: "synthetic-owner" }));
  await insert("capability_evidence", scoped({ revision: 2, idempotency_key: randomUUID(), request_hash: hash,
    action: "revoke", target_id: evidenceId, reason: "synthetic", reviewer_id: "synthetic-owner" }));
  await insert("cost_routing_policies", scoped({ revision: 1, request_id: randomUUID(), request_hash: hash, policy: json({}), actor_id: "synthetic-owner" }));
  await insert("cost_routing_previews", scoped({ policy_revision: 1, request_id: randomUUID(), request_hash: hash, preview: json({}),
    receipt_hash: hash, actor_id: "synthetic-owner" }));
  const policyId = await insert("runtime_routing_policies", scoped({ ...request(), ...actor, expected_generation: 0, policy: json({}),
    candidates: json([{}]), approval_digest: hash, approval_expires_at: sql`now() + interval '1 hour'` }));
  await insert("runtime_routing_receipts", scoped({ ...request(), ...actor, policy_id: policyId, action: "approve", generation: 1 }));
  await insert("runtime_routing_heads", scoped({ policy_id: policyId, generation: 1, configured_at: sql`now()` }), false);
  await insert("runtime_routing_bindings", scoped({ ...request(), ...actor, issue_id: issueId, policy_id: policyId, generation: 1,
    selected_agent_id: agentId, selected_candidate_snapshot: json({}), decision_digest: hash, task_digest: hash,
    state: "run_claimed", run_id: runId, dispatch_request_id: randomUUID(), dispatch_request_digest: hash,
    dispatch_actor_user_id: "synthetic-owner", dispatch_actor_session_id: "synthetic-session", wake_requested_at: sql`now()` }));

  async function snapshot() {
    const result: Record<string, unknown> = {};
    for (const table of [...tables].sort()) {
      const key = sql.identifier(table === "companies" ? "id" : "company_id");
      const [rows] = await db.execute<{ value: unknown }>(sql`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) as value
        from ${sql.identifier(table)} t where ${key} = ${companyId}`);
      result[table] = rows.value;
    }
    const [versions] = await db.execute<{ value: unknown }>(sql`select coalesce(jsonb_agg(to_jsonb(t) order by id), '[]'::jsonb) as value
      from company_secret_versions t where id in (${sql.join(secretVersionIds.map(id => sql`${id}::uuid`), sql`, `)})`);
    result.company_secret_versions = versions.value;
    return result;
  }
  return { companyId, agentId, tables, snapshot };
}
