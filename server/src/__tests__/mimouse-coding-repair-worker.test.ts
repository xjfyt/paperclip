import { afterEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@paperclipai/db";
import { PgDialect } from "drizzle-orm/pg-core";
const service = vi.hoisted(() => ({ dispatch: vi.fn(), reconcile: vi.fn(), reserve: vi.fn() }));
vi.mock("../services/mimouse-coding/repairs.js", () => ({ codingRepairService: () => service }));
vi.mock("../middleware/logger.js", () => ({ logger: { warn: vi.fn() } }));
import { codingRepairWorker, startCodingRepairWorker } from "../services/mimouse-coding/repair-worker.js";
function database(row?: Record<string, unknown>) {
  const where = vi.fn(); const dialect = new PgDialect();
  const chain = { from: () => chain, where: (query: any) => { where(dialect.sqlToQuery(query)); return chain; }, orderBy: () => chain, limit: async () => row ? [row] : [] };
  return { db: { select: () => chain } as unknown as Db, where };
}
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); vi.clearAllMocks(); });
describe("coding repair worker safety reconciliation", () => {
  it("honors an explicit background-worker shutdown without disabling manual fixture services", async () => {
    vi.useFakeTimers(); vi.stubEnv("PAPERCLIP_CODING_REPAIR_WORKER_ENABLED", "false"); const f = database({ state: "dispatched", companyId: "company", id: "attempt" });
    const worker = startCodingRepairWorker(f.db); await vi.advanceTimersByTimeAsync(10000); await worker.stop();
    expect(f.where).not.toHaveBeenCalled(); expect(service.reconcile).not.toHaveBeenCalled();
    await codingRepairWorker(f.db).tick(); expect(service.reconcile).toHaveBeenCalledWith("company", "attempt");
  });
  it("defaults off without reserving or dispatching any task", async () => {
    vi.stubEnv("PAPERCLIP_CODING_REPAIR_ENABLED", "false"); const f = database();
    expect(await codingRepairWorker(f.db).tick()).toBe(false);
    expect(service.dispatch).not.toHaveBeenCalled(); expect(service.reserve).not.toHaveBeenCalled(); expect(service.reconcile).not.toHaveBeenCalled();
    expect(f.where.mock.calls[0][0].params).not.toContain("reserved");
  });
  it.each(["dispatching", "indeterminate", "dispatched", "deadline_stopping"])("reconciles previously authorized %s with dispatch disabled", async state => {
    vi.stubEnv("PAPERCLIP_CODING_REPAIR_ENABLED", "false"); const f = database({ state, companyId: "company", id: "attempt" });
    expect(await codingRepairWorker(f.db).tick("company")).toBe(true);
    expect(service.reconcile).toHaveBeenCalledWith("company", "attempt"); expect(service.reserve).not.toHaveBeenCalled(); expect(service.dispatch).not.toHaveBeenCalled();
    expect(f.where.mock.calls[0][0].sql).toContain('"lease_expires_at"');
  });
  it("keeps safety reconciliation active during dispatch drain, but not warm standby", async () => {
    vi.useFakeTimers(); vi.stubEnv("PAPERCLIP_CODING_REPAIR_ENABLED", "true"); const f = database({ state: "dispatched", companyId: "company", id: "attempt" });
    const worker = startCodingRepairWorker(f.db, {}, () => false, () => true); await vi.advanceTimersByTimeAsync(1); await worker.stop();
    expect(service.reconcile).toHaveBeenCalledOnce(); expect(service.dispatch).not.toHaveBeenCalled();
    expect(f.where.mock.calls[0][0].params).not.toContain("reserved");
    service.reconcile.mockClear(); const standby = startCodingRepairWorker(f.db, {}, () => false, () => false);
    await vi.advanceTimersByTimeAsync(5000); await standby.stop(); expect(service.reconcile).not.toHaveBeenCalled();
  });
  it("starts a safety-only timer when disabled and drains it on stop", async () => {
    vi.useFakeTimers(); vi.stubEnv("PAPERCLIP_CODING_REPAIR_ENABLED", "false"); const f = database({ state: "deadline_stopping", companyId: "company", id: "attempt" });
    const worker = startCodingRepairWorker(f.db); await vi.advanceTimersByTimeAsync(5000); await worker.stop(); const count = service.reconcile.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10000); expect(service.reconcile).toHaveBeenCalledTimes(count); expect(count).toBeGreaterThan(0); expect(service.dispatch).not.toHaveBeenCalled();
  });
});
