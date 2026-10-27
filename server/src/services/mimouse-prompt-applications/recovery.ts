import { legacyControllerBootId } from "../legacy-controller-lease.js";
import { and, desc, eq, isNull, inArray } from "drizzle-orm";
import { heartbeatRunEvents, heartbeatRuns, type Db } from "@paperclipai/db";
import { mimousePromptApplicationDispatches as dispatches } from "@paperclipai/db/schema/mimouse_prompt_applications";
import { appendHeartbeatRunEvent } from "../heartbeat-run-events.js";
import { conflict } from "../../errors.js";
import type { PrivatePromptTx } from "../mimouse-private-prompt-tests/service.js";
/** A mandatory durable start fence distinguishes known pre-start failures from
 * unknown launches. Absence of a PID alone is never treated as stop evidence. */
export async function applicationAttemptStopped(tx: PrivatePromptTx, companyId: string, runId: string, reconcile = false) {
  const [run] = await tx.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.id, runId))).for("share");
  if (!run || !["succeeded", "failed", "cancelled", "timed_out", "interrupted"].includes(run.status) ||
    run.controllerLeaseExpiresAt && run.controllerLeaseExpiresAt > new Date()) return false;
  const [last] = await tx.select({ type: heartbeatRunEvents.eventType }).from(heartbeatRunEvents).where(and(eq(heartbeatRunEvents.companyId, companyId),
    eq(heartbeatRunEvents.runId, runId), isNull(heartbeatRunEvents.sourceEventId),
    inArray(heartbeatRunEvents.eventType, ["prompt_application.start_requested", "prompt_application.provider_stopped"]))).orderBy(desc(heartbeatRunEvents.seq)).limit(1);
  if (!last || last.type === "prompt_application.provider_stopped") return true;
  if (!reconcile || run.controllerBootId !== legacyControllerBootId || !run.processPid || !run.processStartedAt || run.runtimeMode !== "legacy") return false;
  const absent = (pid: number) => { try { process.kill(pid, 0); return false; } catch (error) { return (error as NodeJS.ErrnoException).code === "ESRCH"; } };
  if (!absent(run.processPid) || run.processGroupId && !absent(-run.processGroupId)) return false;
  await appendHeartbeatRunEvent(tx as unknown as Db, { companyId, agentId: run.agentId, runId,
    eventType: "prompt_application.provider_stopped", stream: "system", level: "info", message: "Recorded controlled local process identity is no longer alive.",
    payload: { processPid: run.processPid, processGroupId: run.processGroupId } });
  return true;
}
export async function assertApplicationAttemptsStopped(tx: PrivatePromptTx, companyId: string, agentId: string) {
  const rows = await tx.select({ runId: dispatches.runId }).from(dispatches).where(and(eq(dispatches.companyId, companyId), eq(dispatches.agentId, agentId)));
  for (const row of rows) {
    const [withdrawn] = await tx.select({ id: heartbeatRunEvents.id }).from(heartbeatRunEvents).where(and(eq(heartbeatRunEvents.companyId, companyId),
      eq(heartbeatRunEvents.runId, row.runId), eq(heartbeatRunEvents.eventType, "prompt_application.binding_withdrawn_before_input"), isNull(heartbeatRunEvents.sourceEventId))).limit(1);
    // This bypass is ONLY for configuring a future binding. candidate() still
    // requires real process-stop evidence before the old issue can continue.
    if (!withdrawn && !await applicationAttemptStopped(tx, companyId, row.runId, true)) throw conflict("prompt_application_previous_attempt_unresolved");
  }
}

/** Server-owned evidence, independent of mutable wake/context payloads. */
export async function isPromptApplicationRun(tx: Db | PrivatePromptTx, companyId: string, runId: string) {
  return (await tx.select({ id: heartbeatRunEvents.id }).from(heartbeatRunEvents).where(and(eq(heartbeatRunEvents.companyId, companyId),
    eq(heartbeatRunEvents.runId, runId), eq(heartbeatRunEvents.eventType, "prompt_application.candidate"), isNull(heartbeatRunEvents.sourceEventId))).limit(1)).length > 0;
}
