import type { AuthSession } from "@paperclipai/shared";

/** Scope identity only. Preserve session.id for source classification/display. */
export function authSessionScopeKey(session: AuthSession | null | undefined) {
  return session?.session?.scopeKey ?? session?.session?.id;
}

/** A known null local_trusted session is distinct from an unknown/removed cache. */
export function authSessionIdentity(session: AuthSession | null | undefined): string {
  return session === undefined ? "unknown" : JSON.stringify([
    session?.user?.id ?? session?.session?.userId ?? null,
    authSessionScopeKey(session) ?? null,
  ]);
}
