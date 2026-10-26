import type { WakeupOptions } from "../heartbeat/run-preparation.js";
import type { PrivatePromptRow } from "./service.js";
const authorities = new WeakMap<object, string>();
export function privatePromptWakeOptions(row: PrivatePromptRow): WakeupOptions {
  const opts: WakeupOptions = { source: "on_demand", triggerDetail: "manual", reason: "private_prompt_test",
    idempotencyKey: `private-prompt-test:${row.id}`, requestedByActorType: "user", requestedByActorId: row.actorUserId,
    payload: { issueId: row.issueId }, contextSnapshot: { issueId: row.issueId, forceFreshSession: true } };
  authorities.set(opts, row.id);
  return opts;
}
export function privatePromptWakeAuthority(opts: WakeupOptions): string | null { return authorities.get(opts) ?? null; }
