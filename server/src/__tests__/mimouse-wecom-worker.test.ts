import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Db } from "@paperclipai/db";
vi.mock("../services/mimouse-wecom/receiver.js", () => ({ runWecomReceiver: vi.fn(() => { throw Error("Real transport forbidden"); }) }));
vi.mock("../middleware/logger.js", () => ({ logger: { warn: vi.fn() } }));
import { startWecomWorker, type WecomWorkerDependencies } from "../services/mimouse-wecom/worker.js";
const config = { transport: "long_connection", botId: "bot", product: "app", allowedGroupIds: ["group"], allowedDirectSenderIds: [],
  secret: { secretId: "11111111-1111-4111-8111-111111111111", version: 1 } };
const row = (id: string, token = id) => ({ id, companyId: "company", activationToken: token, config });
const db = {} as Db;
async function tick() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
function fixture() {
  let allowed = true;
  const candidates = vi.fn(async (_tokens: string[]) => [row("one"), row("two"), row("three")]);
  const signals: AbortSignal[] = [];
  const receive = vi.fn(async (_company: string, _id: string, signal: AbortSignal) => {
    signals.push(signal);
    await new Promise<void>(resolve => { signal.addEventListener("abort", () => resolve(), { once: true }); });
    return { stopped: "cancelled" as const };
  });
  const warn = vi.fn();
  const deps: WecomWorkerDependencies = { enabled: true, candidates, receive, warn };
  return { candidates, receive, warn, signals, deps, gate: () => allowed, pause: () => { allowed = false; } };
}
it("flag off allocates no timer, candidates, DB or socket", async () => {
  const f = fixture(), worker = startWecomWorker(db, f.gate, { ...f.deps, enabled: false });
  await worker.reconcile(); await vi.advanceTimersByTimeAsync(10000);
  expect(vi.getTimerCount()).toBe(0); expect(f.candidates).not.toHaveBeenCalled(); expect(f.receive).not.toHaveBeenCalled();
  expect(await worker.stop()).toEqual({ drained: true });
});
it("bounds concurrent receivers to two and aborts immediately on gate reconciliation", async () => {
  const f = fixture(), worker = startWecomWorker(db, f.gate, f.deps); await tick();
  expect(f.receive).toHaveBeenCalledTimes(2);
  await worker.reconcile(); expect(f.receive).toHaveBeenCalledTimes(2);
  f.pause(); await worker.reconcile(); expect(f.signals.every(s => s.aborted)).toBe(true);
  await worker.stop(); await vi.advanceTimersByTimeAsync(3000); expect(f.receive).toHaveBeenCalledTimes(2);
});
it("does not overlap candidate ticks and never starts late results after stop", async () => {
  const f = fixture(); let finish!: (rows: ReturnType<typeof row>[]) => void;
  f.candidates.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const worker = startWecomWorker(db, f.gate, f.deps);
  await worker.reconcile(); await vi.advanceTimersByTimeAsync(3000); expect(f.candidates).toHaveBeenCalledTimes(1);
  const stopping = worker.stop(); finish([row("late")]); await tick(); await stopping; expect(f.receive).not.toHaveBeenCalled();
});
it("never restarts a terminal activation from stale rows; only a new explicit token may run", async () => {
  const f = fixture(); f.candidates.mockResolvedValue([row("one", "activation-a")]);
  const receive = vi.fn(async () => ({ stopped: "displaced" as const }));
  const worker = startWecomWorker(db, f.gate, { ...f.deps, receive }); await tick();
  await worker.reconcile(); await tick(); expect(receive).toHaveBeenCalledTimes(1);
  expect(f.candidates.mock.calls.at(-1)?.[0]).toEqual(["activation-a"]);
  f.candidates.mockResolvedValue([row("one", "activation-b")]); await worker.reconcile(); await tick();
  expect(receive).toHaveBeenCalledTimes(2); await worker.stop();
});
it("validates saved configuration and does not mutate or enable anything", async () => {
  const f = fixture(); f.candidates.mockResolvedValue([{ ...row("bad"), config: { ...config, allowedGroupIds: [] } }]);
  const worker = startWecomWorker(db, f.gate, f.deps); await tick();
  expect(f.receive).not.toHaveBeenCalled(); await worker.stop(); expect(Object.keys(db)).toEqual([]);
});
it("reports bounded shutdown timeout with fixed metadata only and never restarts", async () => {
  const f = fixture(); const receive = vi.fn(() => new Promise<never>(() => {}));
  const worker = startWecomWorker(db, f.gate, { ...f.deps, receive }); await tick();
  const stopping = worker.stop(); await vi.advanceTimersByTimeAsync(5000);
  expect(await stopping).toEqual({ drained: false });
  expect(f.warn).toHaveBeenCalledWith({ event: "wecom_worker_drain_timeout", activeCount: 2 });
  await worker.reconcile(); expect(receive).toHaveBeenCalledTimes(2);
});
it("duplicate supervisors defer global exclusivity to receiver lease acquisition", async () => {
  const f = fixture(); f.candidates.mockResolvedValue([row("one")]); let owned = false, admitted = 0;
  const receive: WecomWorkerDependencies["receive"] = async (_company, _id, signal) => {
    if (owned) return { stopped: "disabled" }; owned = true; admitted++;
    await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true }));
    return { stopped: "cancelled" };
  };
  const a = startWecomWorker(db, f.gate, { ...f.deps, receive });
  const b = startWecomWorker(db, f.gate, { ...f.deps, receive }); await tick();
  expect(admitted).toBe(1); await Promise.all([a.stop(), b.stop()]);
});
