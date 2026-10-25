import { and, asc, eq, isNotNull, isNull, lte, or } from "drizzle-orm";
import { companies, mimouseCodingDeliveries as deliveries, type Db } from "@paperclipai/db";
import { logger } from "../../middleware/logger.js";
import { codingService } from "./service.js";
import { GitLabError, type gitlabClient } from "./gitlab.js";

/** Read-only provider work. Leases, cursors and evidence live in PostgreSQL;
 * process timers only wake the worker. A crash never grants publication. */
export function codingPoller(db: Db, deps: { client?: typeof gitlabClient } = {}) {
  const service = codingService(db, deps);
  async function tick(companyId?: string) {
    if (process.env.PAPERCLIP_GITLAB_POLL_ENABLED !== "true") return false;
    const now = new Date();
    const [row] = await db.select({ id: deliveries.id, companyId: deliveries.companyId }).from(deliveries)
      .innerJoin(companies, eq(companies.id, deliveries.companyId))
      .where(and(eq(companies.status, "active"), eq(deliveries.operationState, "mr_created"), isNotNull(deliveries.mrIid),
        lte(deliveries.nextSyncAt, now), or(isNull(deliveries.syncLease), lte(deliveries.syncLeaseExpiresAt, now)),
        ...(companyId ? [eq(deliveries.companyId, companyId)] : [])))
      .orderBy(asc(deliveries.nextSyncAt)).limit(1);
    if (!row || process.env.PAPERCLIP_GITLAB_POLL_ENABLED !== "true") return false;
    try { await service.sync(row.companyId, row.id, { onlyWhenDue: true }); }
    catch (error) {
      if (error instanceof GitLabError && error.code === "sync_busy_or_not_due") return false;
      // The service persisted a bounded failure code and next retry time.
      // Never log raw vendor errors, tokens or response bodies.
      logger.warn({ code: "coding_poll_failed", deliveryId: row.id }, "Coding evidence refresh requires reconciliation");
    }
    return true;
  }
  return { tick };
}

export function startCodingPollWorker(db: Db, mayRun: () => boolean = () => true) {
  if (process.env.PAPERCLIP_GITLAB_POLL_ENABLED !== "true") return { stop: async () => {} };
  const poller = codingPoller(db); let stopped = false; let running: Promise<unknown> | null = null;
  const wake = () => {
    if (!stopped && mayRun() && !running) running = poller.tick()
      .catch(() => logger.warn({ code: "coding_poll_tick_failed" }, "Coding poll cursor remains in PostgreSQL"))
      .finally(() => { running = null; });
  };
  const timer = setInterval(wake, 5000); timer.unref(); wake();
  return { stop: async () => { stopped = true; clearInterval(timer); await running; } };
}
