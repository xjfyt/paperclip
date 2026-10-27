import type { WakeupOptions } from "../heartbeat/run-preparation.js";
const authorities = new WeakMap<object, string>();
/** Non-serializable capability, issued only after the human run request is durable. */
export function runtimeRoutingWakeOptions(row: { id: string; issueId: string; actorUserId: string }): WakeupOptions {
  const opts: WakeupOptions = { source: "on_demand", triggerDetail: "manual", reason: "runtime_cost_routing",
    idempotencyKey: `runtime-cost-routing:${row.id}`, requestedByActorType: "user", requestedByActorId: row.actorUserId,
    allowRunCoalescing: false, payload: { issueId: row.issueId }, contextSnapshot: { issueId: row.issueId, forceFreshSession: true } };
  authorities.set(opts, row.id); return opts;
}
export const runtimeRoutingWakeAuthority = (opts: WakeupOptions): string | null => authorities.get(opts) ?? null;
