import { and, asc, eq, isNotNull, isNull, lte, notInArray, or, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { mimouseWecomConnections as connections } from "@paperclipai/db/schema/mimouse_wecom";
import { logger } from "../../middleware/logger.js";
import { runWecomReceiver } from "./receiver.js";
import { wecomConfigSchema } from "./protocol.js";

type Candidate = { id: string; companyId: string; activationToken: string | null; config: unknown };
type Result = Awaited<ReturnType<typeof runWecomReceiver>>;
export type WecomWorkerDependencies = {
  enabled: boolean;
  candidates: (finishedTokens: string[]) => Promise<Candidate[]>;
  receive: (companyId: string, id: string, signal: AbortSignal) => Promise<Result>;
  warn: (metadata: { event: string; activeCount: number }) => void;
};
const MAX_ACTIVE = 2, BATCH = 8, MAX_ACTIVATIONS = 1024, DRAIN_MS = 5000;
/** No side effects when off. Root owns lifecycle and calls reconcile on gate transitions. */
export function startWecomWorker(db: Db, mayRun: () => boolean, testOnly?: WecomWorkerDependencies) {
  const enabled = testOnly?.enabled ?? process.env.MIMOUSE_WECOM_WORKER_ENABLED === "true";
  if (!enabled) return { reconcile: async () => {}, stop: async () => ({ drained: true }) };
  const warn = testOnly?.warn ?? (metadata => logger.warn(metadata, "WeCom worker lifecycle"));
  const candidates = testOnly?.candidates ?? (async (finishedTokens: string[]) => db.select({
    id: connections.id, companyId: connections.companyId, activationToken: connections.activationToken, config: connections.config,
  }).from(connections).where(and(eq(connections.enabled, true), isNotNull(connections.activationToken),
    or(isNull(connections.leaseToken), lte(connections.leaseExpiresAt, sql`clock_timestamp()`)),
    finishedTokens.length ? notInArray(connections.activationToken, finishedTokens) : undefined,
  )).orderBy(asc(connections.createdAt)).limit(BATCH));
  const receive = testOnly?.receive ?? ((companyId, id, signal) => runWecomReceiver(db, companyId, id, signal));
  const active = new Map<string, { controller: AbortController; done: Promise<void> }>();
  const attempted = new Set<string>();
  let stopped = false, ticking = false, budgetWarned = false;
  let pendingTick: Promise<void> = Promise.resolve();
  const abortAll = () => { for (const item of active.values()) item.controller.abort(); };
  const permitted = () => { try { return !stopped && mayRun(); } catch { return false; } };
  async function reconcile() {
    // Even an overlapping tick must observe shutdown/standby immediately.
    if (!permitted()) { abortAll(); return; }
    if (ticking || active.size >= MAX_ACTIVE) return;
    if (attempted.size >= MAX_ACTIVATIONS) {
      if (!budgetWarned) warn({ event: "wecom_worker_activation_budget", activeCount: active.size });
      budgetWarned = true; return;
    }
    ticking = true;
    let tickFinished!: () => void;
    pendingTick = new Promise(resolve => { tickFinished = resolve; });
    try {
      const rows = await candidates([...attempted]);
      if (!permitted()) { abortAll(); return; }
      for (const row of rows.slice(0, BATCH)) {
        if (!permitted()) { abortAll(); break; }
        if (active.size >= MAX_ACTIVE || attempted.size >= MAX_ACTIVATIONS) break;
        const token = row.activationToken;
        if (!token || attempted.has(token) || active.has(row.id) || !wecomConfigSchema.safeParse(row.config).success) continue;
        const controller = new AbortController();
        attempted.add(token);
        // Defer invocation until ownership is registered, including synchronous fake errors.
        const done = Promise.resolve().then(() => {
          if (!permitted() || controller.signal.aborted) return { stopped: "cancelled" } as Result;
          return receive(row.companyId, row.id, controller.signal);
        }).then(result => {
          // Failed acquisition is not a terminal run; the DB lease prevents duplication.
          if (result.stopped === "disabled") attempted.delete(token);
        }).catch(() => {
          // Unknown release outcome is terminal for this activation; never reset budgets.
          warn({ event: "wecom_worker_run_failed", activeCount: active.size });
        }).finally(() => { active.delete(row.id); });
        active.set(row.id, { controller, done });
      }
    } catch { warn({ event: "wecom_worker_tick_failed", activeCount: active.size }); }
    finally { ticking = false; tickFinished(); }
  }
  const timer = setInterval(() => { void reconcile(); }, 1000);
  timer.unref();
  void reconcile();
  return {
    reconcile,
    async stop() {
      stopped = true; clearInterval(timer); abortAll();
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const drained = await Promise.race([
        Promise.all([pendingTick, ...[...active.values()].map(item => item.done)]).then(() => true),
        new Promise<false>(resolve => { timeout = setTimeout(() => resolve(false), DRAIN_MS); }),
      ]);
      if (timeout) clearTimeout(timeout);
      if (!drained) warn({ event: "wecom_worker_drain_timeout", activeCount: active.size });
      return { drained };
    },
  };
}
