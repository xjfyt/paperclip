import { and, eq } from "drizzle-orm";
import { activityLog, companies, companyMemberships, heartbeatRuns, issues, projects, routines, routineRuns, mimouseResearchCandidates as candidates, type Db } from "@paperclipai/db";
import { mimouseResearchRoutineBindings as bindings } from "@paperclipai/db/schema/mimouse_research_routines";
import { researchRoutineBindingSchema, researchRoutineReportSchema, researchRoutineReportContract, type ResearchRoutineBindingInput, type ResearchRoutineReportInput } from "@paperclipai/shared/mimouse-research-routines";
import { conflict, forbidden, notFound } from "../../errors.js";
import { canActorReadIssuePrivacy, canActorReadProjectPrivacy } from "../authorization.js";
import { isCompanyOpenResearchBoundary } from "./public-boundary.js";
import { accessService } from "../access.js";
import { prepareResearchReport } from "./evidence.js";
import { researchDigest } from "../mimouse-research/evidence.js";
import { assertResearchReportIdentity } from "./policy.js";
type Actor = Express.Request["actor"];
export function researchRoutineService(db: Db) {
  async function publicBoundary(tx: Db, companyId: string, actor: Actor, source: { projectId?: string | null; issueId?: string | null; parentIssueId?: string | null }) {
    return isCompanyOpenResearchBoundary({ companyId, ...source }, {
      issue: async id => (await tx.select().from(issues).where(and(eq(issues.companyId, companyId), eq(issues.id, id))).for("share"))[0] ?? null,
      project: async id => (await tx.select().from(projects).where(and(eq(projects.companyId, companyId), eq(projects.id, id))).for("share"))[0] ?? null,
      canReadIssue: async issue => await canActorReadIssuePrivacy(tx, actor, issue) && (await accessService(tx).decide({
        actor, action: "issue:read", resource: { type: "issue", companyId, issueId: issue.id, projectId: issue.projectId,
          parentIssueId: issue.parentId, assigneeAgentId: issue.assigneeAgentId, assigneeUserId: issue.assigneeUserId, status: issue.status },
      })).allowed,
      canReadProject: async project => await canActorReadProjectPrivacy(tx, actor, project) && (await accessService(tx).decide({
        actor, action: "project:read", resource: { type: "project", companyId, projectId: project.id },
      })).allowed,
    });
  }
  async function assertAdmin(tx: Db, companyId: string, actor: Actor, intent: "read" | "write" = "write") {
    if (actor.type !== "board" || actor.source !== "session" || !actor.userId) throw forbidden("Signed-in company administrator required");
    const [member] = await tx.select().from(companyMemberships).where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalType, "user"), eq(companyMemberships.principalId, actor.userId))).for("share");
    const [company] = await tx.select().from(companies).where(eq(companies.id, companyId)).for("share");
    const companyAllowed = company?.status === "active" || (intent === "read" && company?.status === "paused");
    if (!companyAllowed || member?.status !== "active" || !["owner", "admin"].includes(member.membershipRole ?? "")) throw forbidden("Active company administrator required");
    return actor.userId;
  }
  return {
    async available(companyId: string, actor: Actor) {
      return db.transaction(async tx => {
        await assertAdmin(tx as unknown as Db, companyId, actor, "read");
        const rows = await tx.select().from(routines).where(eq(routines.companyId, companyId)).for("share");
        const visible = [];
        for (const row of rows) {
          if (!await publicBoundary(tx as unknown as Db, companyId, actor, { projectId: row.projectId, parentIssueId: row.parentIssueId })) continue;
          visible.push({ id: row.id, title: row.title, status: row.status });
        }
        return visible;
      });
    },
    async list(companyId: string, actor: Actor) {
      return db.transaction(async tx => {
        await assertAdmin(tx as unknown as Db, companyId, actor, "read");
        const rows = await tx.select({ binding: bindings, routine: routines }).from(bindings)
          .innerJoin(routines, and(eq(routines.id, bindings.routineId), eq(routines.companyId, bindings.companyId))).where(eq(bindings.companyId, companyId)).for("share");
        const visible = [];
        for (const row of rows) {
          if (!await publicBoundary(tx as unknown as Db, companyId, actor, { projectId: row.routine.projectId, parentIssueId: row.routine.parentIssueId })) continue;
          visible.push({ ...row.binding, routine: { id: row.routine.id, title: row.routine.title, status: row.routine.status }, contract: researchRoutineReportContract(companyId, row.routine.id, row.binding.product) });
        }
        return visible;
      });
    },
    async bind(companyId: string, routineId: string, actor: Actor, raw: ResearchRoutineBindingInput) {
      const input = researchRoutineBindingSchema.parse(raw);
      return db.transaction(async tx => {
        const userId = await assertAdmin(tx as unknown as Db, companyId, actor);
        if (!await accessService(tx as unknown as Db).canUser(companyId, userId, "tasks:assign")) throw forbidden("Missing permission: tasks:assign");
        const [routine] = await tx.select().from(routines).where(and(eq(routines.companyId, companyId), eq(routines.id, routineId))).for("share");
        if (!routine) throw notFound("Routine unavailable");
        if (input.enabled && !routine.projectId && !routine.parentIssueId) throw forbidden("Configure a company-open project or parent before accepting reports");
        if (!await publicBoundary(tx as unknown as Db, companyId, actor, { projectId: routine.projectId, parentIssueId: routine.parentIssueId })) throw forbidden("Research binding requires a company-open source boundary");
        const [binding] = await tx.insert(bindings).values({ ...input, companyId, routineId, configuredByUserId: userId }).onConflictDoUpdate({
          target: [bindings.companyId, bindings.routineId], set: { ...input, configuredByUserId: userId, updatedAt: new Date() },
        }).returning();
        await tx.insert(activityLog).values({ companyId, actorType: "user", actorId: userId, action: "research.routine_bound", entityType: "routine", entityId: routineId,
          details: { enabled: input.enabled } });
        return { ...binding, contract: researchRoutineReportContract(companyId, routineId, input.product), routineStarted: false };
      });
    },
    async report(companyId: string, routineId: string, actor: Actor, raw: ResearchRoutineReportInput) {
      const input = researchRoutineReportSchema.parse(raw);
      if (actor.type !== "agent" || actor.source !== "agent_jwt" || actor.companyId !== companyId || !actor.runId || !actor.agentId) throw forbidden("Signed run-bound agent JWT required");
      return db.transaction(async tx => {
        const [binding] = await tx.select().from(bindings).where(and(eq(bindings.companyId, companyId), eq(bindings.routineId, routineId))).for("share");
        if (!binding?.enabled || binding.product !== input.product || input.sources.some(source => source.product !== binding.product)) throw forbidden("Enabled product-matching research binding required");
        const [company] = await tx.select().from(companies).where(eq(companies.id, companyId)).for("share");
        if (company?.status !== "active") throw forbidden("Active company required");
        const [routine] = await tx.select().from(routines).where(and(eq(routines.companyId, companyId), eq(routines.id, routineId))).for("share");
        const [routineRun] = await tx.select().from(routineRuns).where(and(eq(routineRuns.companyId, companyId), eq(routineRuns.id, input.routineRunId))).for("share");
        const [issue] = await tx.select().from(issues).where(and(eq(issues.companyId, companyId), eq(issues.id, input.issueId))).for("share");
        const [run] = await tx.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.id, actor.runId!))).for("share");
        if (!routine || !routineRun || !issue || !run) throw notFound("Research execution unavailable");
        if (!routine.projectId && !routine.parentIssueId) throw forbidden("Company-open routine project or parent required");
        // A task's write permission never grants permission to copy its private
        // contents into the company-administrator candidate inbox.
        if (!await publicBoundary(tx as unknown as Db, companyId, actor, { projectId: routine.projectId, parentIssueId: routine.parentIssueId, issueId: issue.id })) throw forbidden("Research reports require a company-open source boundary");
        assertResearchReportIdentity({ companyId, routineId, routineRunId: input.routineRunId, issueId: input.issueId, actor, routine, routineRun, issue, run });
        const decision = await accessService(tx as unknown as Db).decide({ actor, action: "issue:mutate", resource: {
          type: "issue", companyId, issueId: issue.id, projectId: issue.projectId, parentIssueId: issue.parentId,
          assigneeAgentId: issue.assigneeAgentId, assigneeUserId: issue.assigneeUserId, status: issue.status,
        } });
        if (!decision.allowed) throw forbidden("Routine task write permission required");
        const prepared = prepareResearchReport(input, { companyId, routineId, routineRunId: routineRun.id, issueId: issue.id, runId: run.id,
          agentId: actor.agentId!, bindingUpdatedAt: binding.updatedAt.toISOString(), reportBodyHash: researchDigest(input), sourceVerification: "agent_report", disposition: "quarantined" });
        const actorId = `agent:${actor.agentId}`;
        const [created] = await tx.insert(candidates).values({ ...prepared, companyId, actorId }).onConflictDoNothing({ target: [candidates.companyId, candidates.requestId] }).returning();
        const prior = created ?? (await tx.select().from(candidates).where(and(eq(candidates.companyId, companyId), eq(candidates.requestId, prepared.requestId))))[0];
        if (!prior || prior.actorId !== actorId || prior.requestDigest !== prepared.requestDigest) throw conflict("This run already submitted a different research report");
        if (created) await tx.insert(activityLog).values({ companyId, actorType: "agent", actorId: actor.agentId!, agentId: actor.agentId!, runId: run.id,
          responsibleUserId: run.responsibleUserId, action: "research.report_received", entityType: "research_candidate", entityId: created.id,
          details: { routineId, routineRunId: routineRun.id, issueId: issue.id, evidenceHash: created.evidenceHash } });
        return { candidateId: prior.id, evidenceHash: prior.evidenceHash, reportBodyHash: prepared.evidence.provenance.reportBodyHash,
          receivedAt: prior.createdAt.toISOString(), duplicate: !created, status: "candidate", disposition: "quarantined", sourceVerification: "agent_report", agentDispatched: false };
      });
    },
  };
}
