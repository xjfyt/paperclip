import { randomUUID } from "node:crypto";

export type TaskDrainState = { startedAt: Date; expiresAt: Date | null; ownerId?: string };
let taskDrainState: TaskDrainState | null = null;
const taskDrainListeners = new Set<() => void>();
/** Synchronous transition notification; callers read the already-mutated state. */
export function subscribeTaskDrainChanges(listener: () => void): () => void {
  taskDrainListeners.add(listener);
  return () => { taskDrainListeners.delete(listener); };
}
function notifyTaskDrainChanges() {
  for (const listener of [...taskDrainListeners]) {
    try { listener(); } catch { /* A consumer cannot roll back admission state or block peers. */ }
  }
}

export function readTaskDrain(now: Date): TaskDrainState | null {
  if (taskDrainState?.expiresAt && taskDrainState.expiresAt.getTime() <= now.getTime()) {
    taskDrainState = null;
    notifyTaskDrainChanges();
  }
  return taskDrainState;
}

export function computeTaskDrain(opts: { ttlMs?: number | null; purpose?: "idle" } = {}): TaskDrainState {
  const startedAt = new Date();
  return { startedAt, expiresAt: opts.ttlMs == null ? null : new Date(startedAt.getTime() + opts.ttlMs),
    ...(opts.purpose === "idle" ? { ownerId: randomUUID() } : {}) };
}

export function applyTaskDrain(drain: TaskDrainState): void {
  taskDrainState = drain;
  notifyTaskDrainChanges();
}
export function startTaskDrain(opts: { ttlMs?: number | null; purpose?: "idle" } = {}): TaskDrainState {
  const drain = computeTaskDrain(opts);
  applyTaskDrain(drain);
  return drain;
}
export function stopTaskDrain(): { wasActive: boolean } {
  const previous = taskDrainState;
  const wasActive = previous !== null && (!previous.expiresAt || previous.expiresAt.getTime() > Date.now());
  taskDrainState = null;
  // An already expired state is cleared once, without a second lazy-expiry notification.
  if (previous) notifyTaskDrainChanges();
  return { wasActive };
}
export function isIdleTaskDrainActive(): boolean { return Boolean(readTaskDrain(new Date())?.ownerId); }

// Tokens count work until its actual promise settles, including after HTTP
// disconnects and after a cleanup batch has been removed from its input queue.
// The generation also catches work which starts AND finishes during a scan.
let generation = 0;
let active = 0;
export function beginIdleTrackedWork(): () => void {
  generation++;
  active++;
  let finished = false;
  return () => {
    if (finished) return;
    finished = true;
    active--;
    generation++;
  };
}
export function trackIdleWork<T>(work: Promise<T>): Promise<T> {
  const finish = beginIdleTrackedWork();
  return work.finally(finish);
}
export function idleWorkSnapshot() { return { generation, active }; }
