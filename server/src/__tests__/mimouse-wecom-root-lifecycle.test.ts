import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { applyTaskDrain, readTaskDrain, stopTaskDrain, subscribeTaskDrainChanges } from "../services/task-admission.js";
const subscriptions: (() => void)[] = [];
const listen = (fn: () => void) => { const off = subscribeTaskDrainChanges(fn); subscriptions.push(off); return off; };
beforeEach(() => { stopTaskDrain(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-26T00:00:00Z")); });
afterEach(() => { for (const off of subscriptions.splice(0)) off(); stopTaskDrain(); vi.useRealTimers(); });
it("publishes apply/stop synchronously after authoritative mutation and unsubscribe prevents delivery", () => {
  const states: boolean[] = [];
  const off = listen(() => states.push(readTaskDrain(new Date()) !== null));
  applyTaskDrain({ startedAt: new Date(), expiresAt: null }); expect(states).toEqual([true]);
  expect(stopTaskDrain()).toEqual({ wasActive: true }); expect(states).toEqual([true, false]);
  stopTaskDrain(); expect(states).toHaveLength(2);
  off(); applyTaskDrain({ startedAt: new Date(), expiresAt: null }); expect(states).toHaveLength(2);
});
it("lazy expiry clears before notifying and recursive reads do not repeat notification", () => {
  const listener = vi.fn(() => { readTaskDrain(new Date()); readTaskDrain(new Date()); }); listen(listener);
  applyTaskDrain({ startedAt: new Date(), expiresAt: new Date(Date.now() + 10) });
  expect(listener).toHaveBeenCalledTimes(1);
  vi.setSystemTime(new Date(Date.now() + 10)); expect(readTaskDrain(new Date())).toBeNull();
  expect(listener).toHaveBeenCalledTimes(2); readTaskDrain(new Date()); stopTaskDrain(); expect(listener).toHaveBeenCalledTimes(2);
});
it("stop clears an expired state with a single notification", () => {
  const listener = vi.fn(); listen(listener);
  applyTaskDrain({ startedAt: new Date(), expiresAt: new Date(Date.now() + 10) });
  vi.setSystemTime(new Date(Date.now() + 20)); expect(stopTaskDrain()).toEqual({ wasActive: false });
  expect(listener).toHaveBeenCalledTimes(2);
});
it("isolates listener errors and delivers a stable listener snapshot", () => {
  const peer = vi.fn(); let removePeer = () => {};
  listen(() => { removePeer(); throw Error("private listener error"); }); removePeer = listen(peer);
  expect(() => applyTaskDrain({ startedAt: new Date(), expiresAt: null })).not.toThrow();
  expect(peer).toHaveBeenCalledTimes(1); expect(readTaskDrain(new Date())).not.toBeNull();
  stopTaskDrain(); expect(peer).toHaveBeenCalledTimes(1);
});
it("root lifecycle wiring gates startup and aborts before awaiting unrelated shutdown without booting root", () => {
  const source = readFileSync(new URL("../index.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  expect(source).toContain("startWecomWorker(db, () => !heartbeatSchedulerStopped && !isWarmStandby() && !isIdleTaskDrainActive())");
  expect(source).toContain('process.env.MIMOUSE_WECOM_WORKER_ENABLED === "true"\n    ? subscribeTaskDrainChanges');
  const start = source.indexOf("  const shutdown = createCoordinatedServerShutdown({");
  expect(start).toBeGreaterThanOrEqual(0);
  const shutdown = source.slice(start);
  const position = (fragment: string) => { const index = shutdown.indexOf(fragment); expect(index, fragment).toBeGreaterThanOrEqual(0); return index; };
  expect(position("heartbeatSchedulerStopped = true")).toBeLessThan(position("void mimouseWecomWorker.reconcile()"));
  expect(position("void mimouseWecomWorker.reconcile()")).toBeLessThan(position("await systemdNotify"));
  expect(position("unsubscribeWecomTaskDrain()")).toBeLessThan(position("await mimouseWecomWorker.stop()"));
  expect(position("await mimouseWecomWorker.stop()")).toBeLessThan(position("await deliveryWork.stop()"));
  expect(shutdown).toContain('if (!wecomDrain.drained) logger.warn({ event: "wecom_shutdown_drain_timeout" }');
});
