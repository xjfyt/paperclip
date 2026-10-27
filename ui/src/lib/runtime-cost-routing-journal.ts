import { routingBindingReferenceSchema, routingJournalSchema, type RoutingJournal, type RoutingScope } from "@paperclipai/shared/runtime-cost-routing-wire";
export type { RoutingJournal, RoutingScope } from "@paperclipai/shared/runtime-cost-routing-wire";
// A new authorization epoch may inspect an old same-session journal only through fresh
// authorized readback. The epoch never carries confirmations or authority to replay.
export function routingJournalKey(scope: RoutingScope) { return `paperclip.runtime-routing.pending.v2:${JSON.stringify([scope.companyId.toLowerCase(), scope.userId, scope.sessionId])}`; }
export function readRoutingJournal(scope: RoutingScope): RoutingJournal | null {
  const raw = sessionStorage.getItem(routingJournalKey(scope)); if (raw === null) return null;
  const value = routingJournalSchema.parse(JSON.parse(raw));
  if (value.companyId !== scope.companyId.toLowerCase() || value.userId !== scope.userId || value.sessionId !== scope.sessionId) throw Error("routing_journal_scope_invalid");
  return value;
}
/** Strict metadata allowlist: never task content, private cases, outputs, secrets or confirmations. */
export function startRoutingJournal(raw: RoutingJournal): RoutingJournal {
  const value = routingJournalSchema.parse(raw); if (readActorRoutingJournal(value)) throw Error("routing_journal_pending");
  const serialized = JSON.stringify(value), key = routingJournalKey(value); sessionStorage.setItem(key, serialized);
  if (sessionStorage.getItem(key) !== serialized) throw Error("routing_journal_unconfirmed"); return value;
}
export function clearRoutingJournal(expected: RoutingJournal) {
  if (JSON.stringify(readRoutingJournal(expected)) !== JSON.stringify(routingJournalSchema.parse(expected))) throw Error("routing_journal_changed");
  const key = routingJournalKey(expected); sessionStorage.removeItem(key); if (sessionStorage.getItem(key) !== null) throw Error("routing_journal_clear_unconfirmed");
}
/** Hash only; plaintext stays in this mounted view and the ordinary task request. */
export async function routingInputDigest(title: string, description?: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify({ title: title.trim(), description: description ?? null })));
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
}

/** A pointer, not a cached binding: it must be fetched again under current authorization. */
export function rememberRoutingBinding(scope: RoutingScope, bindingId: string) {
  const value = routingBindingReferenceSchema.parse({ version: 2, companyId: scope.companyId, userId: scope.userId, sessionId: scope.sessionId, authEpoch: scope.authEpoch, bindingId }), serialized = JSON.stringify(value), key = `${routingJournalKey(scope)}:binding`;
  sessionStorage.setItem(key, serialized); if (sessionStorage.getItem(key) !== serialized) throw Error("routing_binding_pointer_unconfirmed");
}
export function readRoutingBindingReference(scope: RoutingScope): string | null {
  const raw = sessionStorage.getItem(`${routingJournalKey(scope)}:binding`); if (raw === null) return null;
  const value = routingBindingReferenceSchema.parse(JSON.parse(raw));
  if (value.companyId !== scope.companyId.toLowerCase() || value.userId !== scope.userId || value.sessionId !== scope.sessionId) throw Error("routing_binding_pointer_scope_invalid");
  return value.bindingId;
}

/** Discover this actor's prior-session metadata only AFTER a fresh authorized company read.
 * This prevents a new login from silently replacing an uncertain write. No authority or
 * plaintext crosses sessions; callers must offer readback only for an older session. */
export function readActorRoutingJournal(scope: RoutingScope): RoutingJournal | null {
  const prefix = "paperclip.runtime-routing.pending.v2:", matches: RoutingJournal[] = [];
  for (let index = 0; index < sessionStorage.length; index++) {
    const key = sessionStorage.key(index); if (!key?.startsWith(prefix) || key.endsWith(":binding")) continue;
    let identity: unknown; try { identity = JSON.parse(key.slice(prefix.length)); } catch { continue; }
    if (!Array.isArray(identity) || identity.length !== 3 || identity[0] !== scope.companyId.toLowerCase() || identity[1] !== scope.userId || typeof identity[2] !== "string") continue;
    const value = readRoutingJournal({ ...scope, sessionId: identity[2] }); if (value) matches.push(value);
  }
  if (matches.length > 1) throw Error("routing_multiple_pending_requests");
  return matches[0] ?? null;
}
