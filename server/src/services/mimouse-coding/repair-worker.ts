import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { companies, mimouseCodingDeliveries as deliveries, mimouseCodingRepairAttempts as attempts, type Db } from "@paperclipai/db";
import { logger } from "../../middleware/logger.js";
import { codingRepairService } from "./repairs.js";
import { GitLabError } from "./gitlab.js";
type Dependencies = NonNullable<Parameters<typeof codingRepairService>[1]>;
export function codingRepairWorker(db: Db, deps: Dependencies = {}) {
  const service = codingRepairService(db, deps);
  async function tick(companyId?: string, allowDispatch = true) {
    const now = new Date(); const due = new Date(now.getTime() - 30000);
    const [pending] = await db.select().from(attempts).where(and(
      or(...(allowDispatch && process.env.PAPERCLIP_CODING_REPAIR_ENABLED === "true" ? [eq(attempts.state, "reserved")] : []), and(eq(attempts.state, "dispatching"), lte(attempts.leaseExpiresAt, now)), and(inArray(attempts.state, ["indeterminate", "dispatched", "deadline_stopping"]), lte(attempts.updatedAt, due), or(isNull(attempts.lease), lte(attempts.leaseExpiresAt, now)))),
      ...(companyId ? [eq(attempts.companyId, companyId)] : []),
    )).orderBy(asc(attempts.updatedAt)).limit(1);
    if (pending) {
      if (pending.state === "reserved") await service.dispatch(pending.companyId, pending.id);
      else await service.reconcile(pending.companyId, pending.id);
      return true;
    }
    if (!allowDispatch || process.env.PAPERCLIP_CODING_REPAIR_ENABLED !== "true") return false;
    const [row] = await db.select({ id: deliveries.id, companyId: deliveries.companyId }).from(deliveries)
      .innerJoin(companies, eq(companies.id, deliveries.companyId))
      .where(and(eq(companies.status, "active"), eq(deliveries.repairStatus, "armed"), isNull(deliveries.syncLease),
        sql`${deliveries.remoteEvidence}->'pipeline'->>'status' = 'failed'`, ...(companyId ? [eq(deliveries.companyId, companyId)] : [])))
      .orderBy(asc(deliveries.updatedAt)).limit(1);
    if (!row) return false;
    try { await service.reserve(row.companyId, row.id); }
    catch (error) {
      const code = error instanceof GitLabError && /^[a-z0-9_]{1,80}$/.test(error.code) ? error.code : "repair_configuration_invalid";
      if (code !== "repair_evidence_stale_or_unverified") await db.update(deliveries).set({ repairStatus: "needs_human", repairLastCode: code }).where(and(eq(deliveries.id, row.id), eq(deliveries.repairStatus, "armed")));
    }
    return true;
  }
  return { tick };
}
export function startCodingRepairWorker(db: Db, deps: Dependencies = {}, mayRun: () => boolean = () => true, mayReconcile: () => boolean = mayRun) {
  // Separate process/fixture control: feature-off still reconciles prior grants.
  if (process.env.PAPERCLIP_CODING_REPAIR_WORKER_ENABLED === "false") return { stop: async () => {} };
  const worker = codingRepairWorker(db, deps); let stopped = false; let running: Promise<unknown> | null = null;
  const wake = () => { if (!stopped && mayReconcile() && !running) running = worker.tick(undefined, mayRun())
    .catch(() => logger.warn({ code: "coding_repair_worker_failed" }, "Repair state retained for reconciliation"))
    .finally(() => { running = null; }); };
  const timer = setInterval(wake, 5000); timer.unref(); wake();
  return { stop: async () => { stopped = true; clearInterval(timer); await running; } };
}
