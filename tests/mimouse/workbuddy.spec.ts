import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createDb, mimouseWorkbuddyConnections as connections, mimouseWorkbuddyJobs as jobs } from "../../packages/db/src/index.js";
import { workbuddyService } from "../../server/src/services/workbuddy/service.js";
import { WorkBuddyProtocolError } from "../../server/src/services/workbuddy/protocol.js";

test("WorkBuddy uncertain create survives new service instance without duplicate dispatch", async ({ request }) => {
  const company = await (await request.post("/api/companies", { data: { name: `workbuddy ${Date.now()}` } })).json();
  const db = createDb("postgres://paperclip:paperclip@127.0.0.1:54329/paperclip");
  try {
    const owner = "fixture-owner";
    const [connection] = await db.insert(connections).values({ companyId: company.id, ownerUserId: owner, status: "connected" }).returning();
    let dispatched = 0;
    const deps = { token: async () => "fixture", client: { exchange: async () => { throw Error("not used"); }, create: async () => { dispatched++; throw new WorkBuddyProtocolError("transport_unconfirmed", true); }, get: async () => { throw Error("not used"); } } };
    const first = workbuddyService(db, deps); const requestKey = randomUUID();
    const result = await first.createJob(company.id, connection.id, { userId: owner }, requestKey, "调研并提交报告");
    expect(result.dispatchState).toBe("indeterminate"); expect(dispatched).toBe(1);
    const second = workbuddyService(db, deps);
    const recovered = await second.createJob(company.id, connection.id, { userId: owner }, requestKey, "调研并提交报告");
    expect(recovered.id).toBe(result.id); expect(dispatched).toBe(1);
    await expect(second.createJob(company.id, connection.id, { userId: "intruder" }, randomUUID(), "other")).rejects.toThrow("connection_access_denied");
    await expect(second.createJob(company.id, connection.id, { userId: owner }, requestKey, "different prompt")).rejects.toThrow("request_key_payload_mismatch");
    expect(dispatched).toBe(1);
  } finally { await db.$client.end({ timeout: 1 }); }
});

test("WorkBuddy OAuth state binds company/user/session and stores tokens only in vault", async ({ request }) => {
  const company = await (await request.post("/api/companies", { data: { name: `oauth ${Date.now()}` } })).json();
  const db = createDb("postgres://paperclip:paperclip@127.0.0.1:54329/paperclip");
  const saved = { enabled: process.env.PAPERCLIP_WORKBUDDY_ENABLED, id: process.env.PAPERCLIP_WORKBUDDY_CLIENT_ID, secret: process.env.PAPERCLIP_WORKBUDDY_CLIENT_SECRET, origin: process.env.PAPERCLIP_AUTH_PUBLIC_BASE_URL };
  Object.assign(process.env, { PAPERCLIP_WORKBUDDY_ENABLED: "true", PAPERCLIP_WORKBUDDY_CLIENT_ID: "fixture", PAPERCLIP_WORKBUDDY_CLIENT_SECRET: "fixture-only", PAPERCLIP_AUTH_PUBLIC_BASE_URL: "https://app.example" });
  try {
    let exchanges = 0;
    const service = workbuddyService(db, { client: { exchange: async () => { exchanges++; return { access_token: "test-access-never-public", refresh_token: "test-refresh-never-public", token_type: "Bearer", expires_in: 123, open_id: "provider-user", scope: "user.task.readable user.task.invokable" }; }, create: async () => { throw Error("unused"); }, get: async () => { throw Error("unused"); } } });
    const begin = await service.begin(company.id, "owner", "session-one"); const state = new URL(begin.url).searchParams.get("state")!;
    await expect(service.callback(company.id, "owner", "session-two", state, "fixture-code")).rejects.toThrow("invalid_oauth_state");
    expect(exchanges).toBe(0);
    const result = await service.callback(company.id, "owner", "session-one", state, "fixture-code");
    expect(result.status).toBe("connected"); expect(exchanges).toBe(1);
    await expect(service.callback(company.id, "owner", "session-one", state, "fixture-code")).rejects.toThrow("invalid_oauth_state");
    expect(exchanges).toBe(1);
    const visible = await service.listConnections(company.id, "owner"); expect(JSON.stringify(visible)).not.toContain("test-access"); expect(JSON.stringify(visible)).not.toContain("test-refresh");
    const disconnected = await service.disconnect(company.id, result.id, "owner"); expect(disconnected.providerRevocationConfirmed).toBe(false);
  } finally {
    for (const [key, value] of Object.entries({ PAPERCLIP_WORKBUDDY_ENABLED: saved.enabled, PAPERCLIP_WORKBUDDY_CLIENT_ID: saved.id, PAPERCLIP_WORKBUDDY_CLIENT_SECRET: saved.secret, PAPERCLIP_AUTH_PUBLIC_BASE_URL: saved.origin })) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await db.$client.end({ timeout: 1 });
  }
});

test("completed WorkBuddy report is recovered read-only and retained across a service restart", async ({ request }) => {
  const company = await (await request.post("/api/companies", { data: { name: `workbuddy report ${Date.now()}` } })).json();
  const db = createDb("postgres://paperclip:paperclip@127.0.0.1:54329/paperclip");
  try {
    const [connection] = await db.insert(connections).values({ companyId: company.id, ownerUserId: "owner", status: "connected" }).returning();
    const [job] = await db.insert(jobs).values({ companyId: company.id, connectionId: connection.id, requestKey: randomUUID(), promptHash: "fixture", providerJobId: "provider-task", dispatchState: "created", remoteState: "working" }).returning();
    let creates = 0, reportReads = 0;
    const deps = { token: async () => "private-access", client: { exchange: async () => { throw Error("unused"); }, create: async () => { creates++; throw Error("must not create"); }, get: async () => ({ task_id: "provider-task", status: "completed", link: "https://sandbox.example/acp", token: "private-ticket" }) }, report: async () => { reportReads++; return { report: "调研报告 private-access", artifactRefs: ["agent:///artifacts/report.md"] }; } };
    const result = await workbuddyService(db, deps).refreshJob(company.id, job.id, { userId: "owner" });
    expect(result.remoteState).toBe("completed"); expect(result.report).toBe("调研报告 [REDACTED]"); expect(result.artifactRefs).toEqual(["agent:///artifacts/report.md"]);
    expect((await workbuddyService(db, deps).refreshJob(company.id, job.id, { userId: "owner" })).report).toBe(result.report);
    expect(creates).toBe(0); expect(reportReads).toBe(2); expect(JSON.stringify(result)).not.toContain("private-ticket");
  } finally { await db.$client.end({ timeout: 1 }); }
});
