import { eq, inArray, or, sql } from "drizzle-orm";
import { agentWakeupRequests, environmentLeases, heartbeatRuns, type Db } from "@paperclipai/db";
import { agentExecutionsHaveStopped } from "../../agent-execution-stop.js";

export async function fixtureStopState(db: Db, agentId: string) {
  const runs = await db.select({ id: heartbeatRuns.id, status: heartbeatRuns.status, processPid: heartbeatRuns.processPid,
    processGroupId: heartbeatRuns.processGroupId, processStartedAt: heartbeatRuns.processStartedAt,
    controllerLeaseExpiresAt: heartbeatRuns.controllerLeaseExpiresAt, executionStage: heartbeatRuns.executionStage })
    .from(heartbeatRuns).where(eq(heartbeatRuns.agentId, agentId));
  const wakes = await db.select({ id: agentWakeupRequests.id, status: agentWakeupRequests.status, runId: agentWakeupRequests.runId })
    .from(agentWakeupRequests).where(eq(agentWakeupRequests.agentId, agentId));
  const leases = await db.select({ id: environmentLeases.id, status: environmentLeases.status, releasedAt: environmentLeases.releasedAt,
    cleanupStatus: environmentLeases.cleanupStatus }).from(environmentLeases).where(or(
      inArray(environmentLeases.heartbeatRunId, runs.map(run => run.id)),
      eq(sql`${environmentLeases.metadata}->>'agentId'`, agentId),
    ));
  return { stopped: await agentExecutionsHaveStopped(db, [agentId]), runs,
    pendingWakes: wakes.filter(wake => !["completed", "failed", "cancelled", "skipped", "coalesced"].includes(wake.status)),
    activeLeases: leases.filter(lease => (!lease.releasedAt && !(lease.status === "retained" && lease.cleanupStatus === "success"))
      || lease.status === "pending_cleanup" || lease.cleanupStatus === "failed"),
  };
}

type State = Awaited<ReturnType<typeof fixtureStopState>>;
export type ApprovalFixtureTrace = { phase: "waiting" | "refused"; attempt: number; state: State };

/** A preflight is instantaneous. The real approval transaction remains the
 * authority; retry its unchanged request only after actual fixture work drains.
 * No PID/lease fields are cleared and no production refusal is weakened.
 */
export async function approveStoppedFixture<T>(input: {
  db: Db; agentId: string; drain: () => Promise<void>; approve: () => Promise<T>;
  timeoutMs?: number; record?: (trace: ApprovalFixtureTrace) => void;
  afterFirstPreflight?: () => Promise<void>;
  afterRefusal?: (trace: ApprovalFixtureTrace) => Promise<void>;
}): Promise<T> {
  const deadline = Date.now() + (input.timeoutMs ?? 20_000);
  let attempted = 0, firstPreflight = true;
  let lastStopError: unknown;
  while (Date.now() < deadline) {
    await input.drain();
    const state = await fixtureStopState(input.db, input.agentId);
    if (!state.stopped || state.pendingWakes.length || state.activeLeases.length) {
      input.record?.({ phase: "waiting", attempt: attempted, state });
      await new Promise(resolve => setTimeout(resolve, 25));
      continue;
    }
    if (firstPreflight) { firstPreflight = false; await input.afterFirstPreflight?.(); }
    attempted++;
    try { return await input.approve(); }
    catch (error) {
      if (!(error instanceof Error) || error.message !== "prompt_application_agent_execution_not_stopped") throw error;
      lastStopError = error;
      const trace: ApprovalFixtureTrace = { phase: "refused", attempt: attempted, state: await fixtureStopState(input.db, input.agentId) };
      input.record?.(trace);
      await input.afterRefusal?.(trace);
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
  throw lastStopError ?? new Error("Fixture approval did not reach real execution and queue quiescence within its deadline.");
}
