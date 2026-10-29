import { and, desc, eq, gt, inArray, or, sql } from "drizzle-orm";
import { authSessions, authUsers, companies, companyMemberships, heartbeatRuns, issues, projects, routines, routineRuns,
  mimouseResearchCandidates as candidates, type Db } from "@paperclipai/db";
import { researchHistoryQuerySchema, type ResearchHistoryItem, type ResearchHistoryPage, type ResearchHistoryQuery } from "@paperclipai/shared/mimouse-research-history";
import { forbidden, notFound } from "../../errors.js";
import { canActorReadIssuePrivacy, canActorReadProjectPrivacy, type AuthorizationActor } from "../authorization.js";
import { canActorReadHeartbeatRun } from "../heartbeat-run-privacy.js";
import { accessService } from "../access.js";
import { isCompanyOpenResearchBoundary } from "./public-boundary.js";
import { boundedHistory, historyReadBudget, historyUnavailable } from "./history-budget.js";
type Actor = Express.Request["actor"];
const iso = (date: Date | null) => date?.toISOString() ?? null;
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
/** Metadata only: never selects report bodies, runtime output or trigger payload. */
export async function researchRoutineHistory(db: Db, companyId: string, routineId: string, actor: Actor, raw: ResearchHistoryQuery): Promise<ResearchHistoryPage> {
  const input = researchHistoryQuerySchema.parse(raw);
  if (actor.type !== "board" || actor.source !== "session" || !actor.userId || !actor.sessionId) throw forbidden("Signed-in company administrator required");
  return boundedHistory(deadline => db.transaction(async transaction => {
    await transaction.execute(sql`set local statement_timeout = '1500ms'`);
    await transaction.execute(sql`set local lock_timeout = '500ms'`);
    const { db: tx, check } = historyReadBudget(transaction as unknown as Db, deadline), access = accessService(tx);
    const [session] = await tx.select({ id: authSessions.id }).from(authSessions).innerJoin(authUsers, eq(authUsers.id, authSessions.userId))
      .where(and(eq(authSessions.id, actor.sessionId!), eq(authSessions.userId, actor.userId!), gt(authSessions.expiresAt, new Date())));
    const [member] = await tx.select({ role: companyMemberships.membershipRole }).from(companyMemberships).where(and(
      eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalType, "user"), eq(companyMemberships.principalId, actor.userId!), eq(companyMemberships.status, "active")));
    const [company] = await tx.select({ status: companies.status }).from(companies).where(eq(companies.id, companyId));
    if (!session || !member || !["owner", "admin"].includes(member.role ?? "") || !company || !["active", "paused"].includes(company.status)) throw forbidden("Active company administrator required");
    // Same verified principal, not a dummy publicness probe. Neither caller flags
    // nor a DB instance-admin role may bypass canonical source/run authorization.
    const sourceActor: AuthorizationActor = { type: "board", source: "session", userId: actor.userId, sessionId: actor.sessionId,
      companyIds: [companyId], memberships: [{ companyId, membershipRole: member.role, status: "active" }],
      isInstanceAdmin: false, ignoreInstanceAdmin: true };
    // Public-boundary checks need identities, not private task descriptions or project configuration.
    const issueFields = { id: issues.id, companyId: issues.companyId, visibility: issues.visibility, projectId: issues.projectId,
      parentId: issues.parentId, privacyParentIssueId: issues.privacyParentIssueId, privacyRootIssueId: issues.privacyRootIssueId,
      responsibleUserId: issues.responsibleUserId, createdByUserId: issues.createdByUserId, assigneeUserId: issues.assigneeUserId,
      assigneeAgentId: issues.assigneeAgentId, status: issues.status, originKind: issues.originKind, originId: issues.originId, originRunId: issues.originRunId };
    const projectFields = { id: projects.id, companyId: projects.companyId, visibility: projects.visibility };
    const issueCache = new Map<string, Pick<typeof issues.$inferSelect, keyof typeof issueFields> | null>();
    const projectCache = new Map<string, Pick<typeof projects.$inferSelect, keyof typeof projectFields> | null>();
    const issue = async (id: string) => {
      if (!issueCache.has(id)) issueCache.set(id, (await tx.select(issueFields).from(issues).where(and(eq(issues.companyId, companyId), eq(issues.id, id))).limit(1))[0] ?? null);
      return issueCache.get(id)!;
    };
    const boundary = async (source: { projectId?: string | null; issueId?: string | null; parentIssueId?: string | null }) => isCompanyOpenResearchBoundary({ companyId, ...source }, {
      onTraversalLimit: () => { throw historyUnavailable(); },
      issue, project: async id => {
        if (!projectCache.has(id)) projectCache.set(id, (await tx.select(projectFields).from(projects).where(and(eq(projects.companyId, companyId), eq(projects.id, id))).limit(1))[0] ?? null);
        return projectCache.get(id)!;
      },
      canReadIssue: async row => await canActorReadIssuePrivacy(tx, sourceActor, row) && (await access.decide({ actor: sourceActor, action: "issue:read", resource: {
        type: "issue", companyId, issueId: row.id, projectId: row.projectId, parentIssueId: row.parentId, assigneeAgentId: row.assigneeAgentId, assigneeUserId: row.assigneeUserId, status: row.status,
      } })).allowed,
      canReadProject: async row => await canActorReadProjectPrivacy(tx, sourceActor, row) && (await access.decide({ actor: sourceActor, action: "project:read", resource: { type: "project", companyId, projectId: row.id } })).allowed,
    });
    const [routine] = await tx.select({ projectId: routines.projectId, parentIssueId: routines.parentIssueId }).from(routines).where(and(eq(routines.companyId, companyId), eq(routines.id, routineId))).limit(1);
    if (!routine || !await boundary(routine)) throw notFound("Research history unavailable");
    const selection = { id: routineRuns.id, status: routineRuns.status, linkedIssueId: routineRuns.linkedIssueId,
      createdAt: routineRuns.createdAt, triggeredAt: routineRuns.triggeredAt, completedAt: routineRuns.completedAt };
    type Row = { [K in keyof typeof selection]: K extends "createdAt" | "triggeredAt" ? Date : K extends "completedAt" ? Date | null : K extends "linkedIssueId" ? string | null : string };
    async function project(row: Row): Promise<ResearchHistoryItem | null> {
      check();
      if (row.linkedIssueId && !await boundary({ issueId: row.linkedIssueId })) return null;
      const source = row.linkedIssueId ? await issue(row.linkedIssueId) : null;
      let needsReview = (!source && ["issue_created", "completed"].includes(row.status)) || Boolean(source && (source.originKind !== "routine_execution" || source.originId !== routineId || source.originRunId !== row.id) && row.status !== "coalesced");
      const attempts = source && row.status !== "coalesced" ? await tx.select({ id: heartbeatRuns.id, companyId: heartbeatRuns.companyId,
        agentId: heartbeatRuns.agentId, scopeKind: heartbeatRuns.scopeKind, issueId: heartbeatRuns.issueId, status: heartbeatRuns.status,
        createdAt: heartbeatRuns.createdAt, startedAt: heartbeatRuns.startedAt, finishedAt: heartbeatRuns.finishedAt }).from(heartbeatRuns)
        .where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.issueId, source.id)))
        .orderBy(desc(heartbeatRuns.createdAt), desc(heartbeatRuns.id)).limit(101) : [];
      if (attempts.length > 100) needsReview = true;
      for (const run of attempts) if (!await canActorReadHeartbeatRun(tx, access, sourceActor, run)) return null;
      const reportRows = await tx.select({ id: candidates.id, requestId: candidates.requestId, actorId: candidates.actorId, createdAt: candidates.createdAt,
        evidenceHash: candidates.evidenceHash, mode: sql<string>`${candidates.evidence}->>'evidenceMode'`,
        provenance: sql<unknown>`case when octet_length((${candidates.evidence}->'provenance')::text) <= 2048 then ${candidates.evidence}->'provenance' else null end` }).from(candidates).where(and(eq(candidates.companyId, companyId),
          or(sql`${candidates.evidence}->'provenance'->>'routineRunId' = ${row.id}`,
            ...(attempts.length ? [inArray(candidates.requestId, attempts.map(run => run.id))] : []))))
        .orderBy(desc(candidates.createdAt), desc(candidates.id)).limit(101);
      if (reportRows.length > 100) needsReview = true;
      const reports: ResearchHistoryItem["reports"] = [];
      const seen = new Set<string>();
      for (const report of reportRows) {
        const p = record(report.provenance);
        // Even malformed metadata must not disclose a private linked source.
        if (uuid(p.issueId) && !await boundary({ issueId: p.issueId })) return null;
        const run = attempts.find(attempt => attempt.id === p.runId);
        const valid = /^[a-f0-9]{64}$/.test(report.evidenceHash) && report.mode === "agent_report" && p.companyId === companyId && p.routineId === routineId && p.routineRunId === row.id
          && p.issueId === row.linkedIssueId && run && p.agentId === run.agentId && p.runId === report.requestId && report.actorId === `agent:${run.agentId}`
          && run.scopeKind === "issue" && p.sourceVerification === "agent_report" && p.disposition === "quarantined"
          && typeof p.reportBodyHash === "string" && /^[a-f0-9]{64}$/.test(p.reportBodyHash)
          && typeof p.bindingUpdatedAt === "string" && Number.isFinite(Date.parse(p.bindingUpdatedAt));
        if (!valid || seen.has(report.requestId) || needsReview || row.status === "coalesced") { needsReview = true; continue; }
        seen.add(report.requestId);
        reports.push({ candidateId: report.id, runId: report.requestId, receivedAt: report.createdAt.toISOString(), evidenceHash: report.evidenceHash, sourceVerification: "agent_report", disposition: "quarantined" });
      }
      return { id: row.id, status: row.status, createdAt: row.createdAt.toISOString(), triggeredAt: row.triggeredAt.toISOString(), completedAt: iso(row.completedAt),
        issueId: row.linkedIssueId, attempts: row.status === "coalesced" ? [] : attempts.slice(0, 100).map(run => ({ id: run.id, status: run.status, createdAt: run.createdAt.toISOString(), startedAt: iso(run.startedAt), finishedAt: iso(run.finishedAt) })),
        reports: needsReview ? [] : reports, reportState: needsReview ? "needs_review" : row.status === "coalesced" ? "coalesced" : reports.length ? "received" : "not_received", externalSourcesVerified: false, agentDispatched: false };
    }
    let cursor = input.beforeId;
    if (cursor) {
      const [row] = await tx.select(selection).from(routineRuns).where(and(eq(routineRuns.companyId, companyId), eq(routineRuns.routineId, routineId), eq(routineRuns.id, cursor))).limit(1);
      if (!row || !await project(row)) throw notFound("Research history cursor unavailable");
    }
    const items: ResearchHistoryItem[] = [];
    let scanned = 0;
    while (items.length <= input.limit) {
      check();
      if (scanned >= 1000) throw historyUnavailable();
      const rows = await tx.select(selection).from(routineRuns).where(and(eq(routineRuns.companyId, companyId), eq(routineRuns.routineId, routineId),
        cursor ? sql`(${routineRuns.createdAt}, ${routineRuns.id}) < (select created_at, id from routine_runs where id = ${cursor}::uuid and company_id = ${companyId}::uuid and routine_id = ${routineId}::uuid)` : undefined))
        .orderBy(desc(routineRuns.createdAt), desc(routineRuns.id)).limit(Math.min(50, 1000 - scanned));
      scanned += rows.length;
      for (const row of rows) {
        const item = await project(row); if (item) items.push(item);
        if (items.length > input.limit) break;
      }
      if (rows.length < 50 || items.length > input.limit) break;
      cursor = rows.at(-1)!.id;
    }
    check();
    return { companyId, routineId, items: items.slice(0, input.limit), nextBeforeId: items.length > input.limit ? items[input.limit - 1]!.id : null,
      externalSourcesVerified: false, agentDispatched: false };
  }, { isolationLevel: "repeatable read", accessMode: "read only" }));
}
