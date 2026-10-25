import { createFixtureDb } from "./fixture-db.js";
import { expect, test } from "@playwright/test";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { companySecrets, mimouseWorkbuddyConnections as connections, mimouseWorkbuddyJobs as jobs } from "../../packages/db/src/index.js";
import { workbuddyService } from "../../server/src/services/workbuddy/service.js";
import { WorkBuddyProtocolError } from "../../server/src/services/workbuddy/protocol.js";
const require = createRequire(new URL("../../server/package.json", import.meta.url));
const { eq } = await import(require.resolve("drizzle-orm"));

test("WorkBuddy uncertain create survives new service instance without duplicate dispatch", async ({ request }) => {
  const company = await (await request.post("/api/companies", { data: { name: `workbuddy ${Date.now()}` } })).json();
  const db = await createFixtureDb();
  try {
    const owner = "fixture-owner"; const allowedAgent = randomUUID();
    const [connection] = await db.insert(connections).values({ companyId: company.id, ownerUserId: owner, status: "connected", credentialIdentity: "fixture-identity", allowedAgentIds: [allowedAgent] }).returning();
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
    await expect(second.createJob(company.id, connection.id, { agentId: allowedAgent, responsibleUserId: "other-owner" }, requestKey, "调研并提交报告")).rejects.toThrow("connection_access_denied");
    await expect(second.createJob(company.id, connection.id, { agentId: allowedAgent }, requestKey, "调研并提交报告")).rejects.toThrow("connection_access_denied");
    expect((await second.createJob(company.id, connection.id, { agentId: allowedAgent, responsibleUserId: owner }, requestKey, "调研并提交报告")).id).toBe(result.id);
    expect(dispatched).toBe(1);
  } finally { await db.$client.end({ timeout: 1 }); }
});

test("WorkBuddy OAuth state binds company/user/session and stores tokens only in vault", async ({ request }) => {
  const company = await (await request.post("/api/companies", { data: { name: `oauth ${Date.now()}` } })).json();
  const db = await createFixtureDb();
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
    const [stored] = await db.select().from(connections).where(eq(connections.id, result.id));
    expect(stored.tokenSecretRef).toBeNull(); expect(stored.tokenMaterial).toBeTruthy(); expect(JSON.stringify(stored.tokenMaterial)).not.toContain("test-access-never-public");
    expect(await db.select().from(companySecrets).where(eq(companySecrets.companyId, company.id))).toHaveLength(0);
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
  const db = await createFixtureDb();
  try {
    const [connection] = await db.insert(connections).values({ companyId: company.id, ownerUserId: "owner", status: "connected", credentialIdentity: "fixture-identity" }).returning();
    const [job] = await db.insert(jobs).values({ companyId: company.id, connectionId: connection.id, requestKey: randomUUID(), promptHash: "fixture", providerJobId: "provider-task", credentialIdentity: "fixture-identity", dispatchState: "created", remoteState: "working" }).returning();
    let creates = 0, reportReads = 0;
    const deps = { token: async () => "private-access", client: { exchange: async () => { throw Error("unused"); }, create: async () => { creates++; throw Error("must not create"); }, get: async () => ({ task_id: "provider-task", status: "completed", link: "https://sandbox.example/acp", token: "private-ticket" }) }, report: async () => { reportReads++; return { report: "调研报告 private-access", artifactRefs: ["agent:///artifacts/report.md"] }; } };
    const result = await workbuddyService(db, deps).refreshJob(company.id, job.id, { userId: "owner" });
    expect(result.remoteState).toBe("completed"); expect(result.report).toBe("调研报告 [REDACTED]"); expect(result.artifactRefs).toEqual(["agent:///artifacts/report.md"]);
    expect((await workbuddyService(db, deps).refreshJob(company.id, job.id, { userId: "owner" })).report).toBe(result.report);
    expect(creates).toBe(0); expect(reportReads).toBe(2); expect(JSON.stringify(result)).not.toContain("private-ticket");
  } finally { await db.$client.end({ timeout: 1 }); }
});

test("readiness is owner-granted and read-only; refresh uses one private-vault lease", async ({ request }) => {
  const company = await (await request.post("/api/companies", { data: { name: `workbuddy readiness ${Date.now()}` } })).json();
  const db = await createFixtureDb(); const agentId = randomUUID();
  const keys = ["PAPERCLIP_WORKBUDDY_ENABLED", "PAPERCLIP_WORKBUDDY_CLIENT_ID", "PAPERCLIP_WORKBUDDY_CLIENT_SECRET", "PAPERCLIP_AUTH_PUBLIC_BASE_URL"] as const; const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { PAPERCLIP_WORKBUDDY_ENABLED: "true", PAPERCLIP_WORKBUDDY_CLIENT_ID: "fixture", PAPERCLIP_WORKBUDDY_CLIENT_SECRET: "fixture-only", PAPERCLIP_AUTH_PUBLIC_BASE_URL: "https://app.example" });
  let releaseRefresh!: (value: any) => void; let refreshes = 0, reads = 0, creates = 0;
  const token = { access_token: "private-initial", refresh_token: "private-refresh", token_type: "Bearer" as const, expires_in: 1, open_id: "owner-provider", scope: "user.task.readable user.task.invokable" };
  try {
    const service = workbuddyService(db, { client: {
      exchange: async form => { if (form.grant_type !== "refresh_token") return token; refreshes++; return await new Promise(resolve => { releaseRefresh = resolve; }); },
      create: async () => { creates++; throw Error("Readiness must not create tasks"); }, get: async () => { throw Error("unused"); },
      checkAccess: async access => { expect(access).toBe("private-after-refresh"); reads++; return { taskReadVerified: true }; },
    } });
    const start = await service.begin(company.id, "owner", "session"); const connected = await service.callback(company.id, "owner", "session", new URL(start.url).searchParams.get("state")!, "fixture");
    await expect(service.verifyForAgent(company.id, connected.id, agentId)).rejects.toThrow("connection_access_denied"); expect(refreshes).toBe(0);
    await db.update(connections).set({ allowedAgentIds: [agentId] }).where(eq(connections.id, connected.id));
    const first = service.verifyForAgent(company.id, connected.id, agentId);
    await expect.poll(() => refreshes).toBe(1);
    await expect(service.verifyForAgent(company.id, connected.id, agentId)).rejects.toThrow(/connection_not_ready|refresh_in_progress/); expect(refreshes).toBe(1);
    releaseRefresh({ ...token, access_token: "private-after-refresh", expires_in: 3600 }); expect(await first).toEqual({ ownerBound: true, taskReadVerified: true });
    expect(reads).toBe(1); expect(creates).toBe(0);
    const [row] = await db.select().from(connections).where(eq(connections.id, connected.id)); expect(row.tokenVersion).toBe(2); expect(row.status).toBe("connected"); expect(JSON.stringify(row.tokenMaterial)).not.toContain("private-after-refresh");
    await service.disconnect(company.id, connected.id, "owner"); await expect(service.verifyForAgent(company.id, connected.id, agentId)).rejects.toThrow("connection_access_denied"); expect(reads).toBe(1);
  } finally { for (const key of keys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } await db.$client.end({ timeout: 1 }); }
});
