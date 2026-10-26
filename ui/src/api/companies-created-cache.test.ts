import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { Company } from "@paperclipai/shared";
import { cacheCreatedCompanyForAccount } from "./companies-query";
import { queryKeys } from "../lib/queryKeys";

const created = { id: "new", issuePrefix: "NEW" } as Company;
const origin = { userId: "u1", sessionId: "s1" };
const session = (userId = "u1", id = "s1") => ({ user: { id: userId }, session: { id } });
function client() {
  const queryClient = new QueryClient();
  queryClient.setQueryData(queryKeys.auth.session, session());
  return queryClient;
}

describe("created company cache ownership", () => {
  it.each(["account", "session", "invalidated", "intent"])("declines a stale %s before caching", async reason => {
    const q = client();
    if (reason === "account") q.setQueryData(queryKeys.auth.session, session("u2", "s2"));
    if (reason === "session") q.setQueryData(queryKeys.auth.session, session("u1", "s2"));
    if (reason === "invalidated") await q.invalidateQueries({ queryKey: queryKeys.auth.session, refetchType: "none" });
    expect(await cacheCreatedCompanyForAccount(q, created, origin, () => reason !== "intent")).toBe(false);
    expect(q.getQueryData(queryKeys.companies.list("u1"))).toBeUndefined();
    expect(q.getQueryData(queryKeys.companies.list("u2"))).toBeUndefined();
    q.clear();
  });

  it.each(["account", "intent"])("rechecks %s after awaiting cancellation", async reason => {
    const q = client(); let current = true;
    vi.spyOn(q, "cancelQueries").mockImplementationOnce(async () => {
      if (reason === "account") q.setQueryData(queryKeys.auth.session, session("u2", "s2"));
      else current = false;
    });
    expect(await cacheCreatedCompanyForAccount(q, created, origin, () => current)).toBe(false);
    expect(q.getQueryData(queryKeys.companies.list("u1"))).toBeUndefined();
    expect(q.getQueryData(queryKeys.companies.list("u2"))).toBeUndefined();
    q.clear();
  });
});
