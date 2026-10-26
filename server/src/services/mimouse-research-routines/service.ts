import { and, eq } from "drizzle-orm";
import { activityLog, companies, companyMemberships, heartbeatRuns, issues, routines, routineRuns, mimouseResearchCandidates as candidates, type Db } from "@paperclipai/db";
import { mimouseResearchRoutineBindings as bindings } from "@paperclipai/db/schema/mimouse_research_routines";
import { researchRoutineBindingSchema, researchRoutineReportSchema, researchRoutineReportContract, type ResearchRoutineBindingInput, type ResearchRoutineReportInput } from "@paperclipai/shared/mimouse-research-routines";
import { conflict, forbidden, notFound } from "../../errors.js";
import { accessService } from "../access.js";
import { prepareResearchReport } from "./evidence.js";
import { researchDigest } from "../mimouse-research/evidence.js";
import { assertResearchReportIdentity } from "./policy.js";
type Actor = Express.Request["actor"];
export function researchRoutineService(db: Db) {
  async function assertAdmin(tx: Db, companyId: string, actor: Actor) {
    if (actor.type !== "board" || actor.source !== "session" || !actor.userId) throw forbidden("Signed-in company administrator required");
    const [member] = await tx.select().from(companyMemberships).where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalType, "user"), eq(companyMemberships.principalId, actor.userId))).for("share");
    const [company] = await tx.select().from(companies).where(eq(companies.id, companyId)).for("share");
    if (company?.status !== "active" || member?.status !== "active" || !["owner", "admin"].includes(member.membershipRole ?? "")) throw forbidden("Active company administrator required");
    return actor.userId;
  }
  return {
    async list(companyId: string, actor: Actor) {
      return db.transaction(async tx => {
        await assertAdmin(tx as unknown as Db, companyId, actor);
        const rows = await tx.select({ binding: bindings, routine: { id: routines.id, title: routines.title, status: routines.status } }).from(bindings)
          .innerJoin(routines, and(eq(routines.id, bindings.routineId), eq(routines.companyId, bindings.companyId))).where(eq(bindings.companyId, companyId));
        return rows.map(row => ({ ...row.binding, routine: row.routine, contract: researchRoutineReportContract(companyId, row.routine.id, row.binding.product) }));
      });
    },
    async bind(companyId: string, routineId: string, actor: Actor, raw: ResearchRoutineBindingInput) {
      const input = researchRoutineBindingSchema.parse(raw);
      return db.transaction(async tx => {
        const userId = await assertAdmin(tx as unknown as Db, companyId, actor);
        if (!await accessService(tx as unknown as Db).canUser(companyId, userId, "tasks:assign")) throw forbidden("Missing permission: tasks:assign");
        const [routine] = await tx.select().from(routines).where(and(eq(routines.companyId, companyId), eq(routines.id, routineId))).for("share");
        if (!routine) throw notFound("Routine unavailable");
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
