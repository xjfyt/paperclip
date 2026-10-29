import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createTenantSessionRecoveryCoordinator,
  tenantSessionRecovery,
} from "@/lib/tenant-session-recovery";
import { authApi } from "./auth";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("authApi.getSession", () => {
  const session = { session: { id: "paperclip:session:user", userId: "user" }, user: { id: "user", name: null, email: null, image: null }, sentryDsn: null };
  it.each([false, true])("adds the opaque header after parsing the legacy JSON (nested=%s)", async nested => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(nested ? { data: session } : session, {
      headers: { "X-Paperclip-Session-Scope": "a".repeat(64) },
    })));
    await expect(authApi.getSession()).resolves.toEqual({ ...session, session: { ...session.session, scopeKey: "a".repeat(64) } });
  });
  it.each([undefined, "", "raw-secret", "unknown"])("keeps legacy identity when no valid marker exists (%s)", async marker => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(session, { headers: marker === undefined ? {} : { "X-Paperclip-Session-Scope": marker } })));
    await expect(authApi.getSession()).resolves.toEqual(session);
  });
  it("does not promote invalid JSON into an authenticated session using a marker", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(null, { headers: { "X-Paperclip-Session-Scope": "a".repeat(64) } })));
    await expect(authApi.getSession()).resolves.toBeNull();
  });

  it("returns null for an ordinary local 401", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(authApi.getSession()).resolves.toBeNull();
  });

  it("initiates recovery and stays pending for a Cloud tenant-session 401", async () => {
    const reload = vi.fn();
    const recovery = createTenantSessionRecoveryCoordinator(reload);
    vi.spyOn(tenantSessionRecovery, "recoverIfNeeded").mockImplementation(recovery.recoverIfNeeded);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "tenant_session_required" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const request = authApi.getSession();
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));

    let settled = false;
    void request.then(
      () => { settled = true; },
      () => { settled = true; },
    );
    await Promise.resolve();
    expect(settled).toBe(false);
  });
});

describe("authApi.signOut", () => {
  it.each([null, {}, { success: false }, { success: "true" }, { redirect: true, url: "https://id.example/logout" }])(
    "rejects a response without explicit local success: %j", async payload => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(payload)));
      await expect(authApi.signOut()).rejects.toThrow("Local sign-out was not confirmed");
    },
  );

  it.each(["javascript:alert(1)", "data:text/html,test", "https://user:password@id.example/logout", "http://id.example/logout"])(
    "keeps local success without navigating an unsafe IdP URL: %s", async url => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ success: true, redirect: true, url })));
      await expect(authApi.signOut()).resolves.toEqual({ success: true, redirect: true });
    },
  );

  it("preserves a server-issued allowed IdP logout URL", async () => {
    const url = "https://id.example/logout?id_token_hint=not-persisted";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ success: true, redirect: true, url })));
    await expect(authApi.signOut()).resolves.toEqual({ success: true, redirect: true, url });
  });

  it("returns the managed deployment redirect from the response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, redirectTo: "/cloud/logout" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(authApi.signOut()).resolves.toEqual({
      success: true,
      redirectTo: "/cloud/logout",
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/sign-out", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
  });
});
