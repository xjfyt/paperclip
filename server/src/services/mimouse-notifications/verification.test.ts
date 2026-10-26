import { beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ rows: {} as Record<string, Record<string, any>[]>, calls: [] as string[] }));
vi.mock("@paperclipai/db", () => {
  const table = (name: string) => new Proxy({ name }, { get: (target, key) => key === "name" ? target.name : `${name}.${String(key)}` });
  return Object.fromEntries(Object.entries({ companySecrets: "secrets", companySecretVersions: "versions", companySecretProviderConfigs: "providers", mimouseNotificationEndpoints: "endpoints", mimouseNotificationDeliveries: "deliveries", mimouseNotificationReviews: "reviews", mimouseNotificationSubscriptions: "subscriptions" }).map(([key, name]) => [key, table(name)]));
});
vi.mock("drizzle-orm", () => ({
  eq: (key: string, value: any) => (row: any) => row[key] === (typeof value === "string" && value in row ? row[value] : value),
  and: (...checks: any[]) => (row: any) => checks.every(fn => fn(row)), desc: (key: string) => key,
  sql: (_strings: TemplateStringsArray, key: string, version: string) => (row: any) => String(row[key].configVersion) === version,
}));
import type { Db } from "@paperclipai/db";
import { notificationVerification } from "./verification.js";
const flatten = (name: string, row: any) => Object.fromEntries(Object.entries(row).map(([key, value]) => [`${name}.${key}`, value]));
function database() {
  return { select: (projection?: any) => {
    let source = "", rows: any[] = [], order: string[] = [], limit = Infinity;
    const chain: any = {
      from: (table: any) => { source = table.name; fixture.calls.push(source); rows = fixture.rows[source].map(row => flatten(source, row)); return chain; },
      innerJoin: (table: any, check: any) => { rows = rows.flatMap(row => fixture.rows[table.name].map(other => ({ ...row, ...flatten(table.name, other) }))).filter(check); return chain; },
      where: (check: any) => { rows = rows.filter(check); return chain; }, orderBy: (...keys: string[]) => { order = keys; return chain; }, limit: (n: number) => { limit = n; return chain; },
      then: (resolve: any, reject: any) => Promise.resolve(rows.sort((a, b) => { for (const key of order) { if (a[key] < b[key]) return 1; if (a[key] > b[key]) return -1; } return 0; }).slice(0, limit).map(row => {
        const whole = (name: string) => Object.fromEntries(Object.entries(row).filter(([key]) => key.startsWith(`${name}.`)).map(([key, value]) => [key.slice(name.length + 1), value]));
        return projection ? Object.fromEntries(Object.entries(projection).map(([key, value]: any) => [key, typeof value === "string" ? row[value] : whole(value.name)])) : whole(source);
      })).then(resolve, reject),
    }; return chain;
  } } as unknown as Db;
}
const time = new Date("2026-01-01T00:00:00Z");
const scope = { endpointId: "e", configVersion: 2, verificationEpoch: 3, kind: "wecom_webhook", secretRef: "s", secretVersion: 1 };
const delivery = (id: string, state: string, createdAt = time, patch = {}) => ({ id, companyId: "c", endpointId: "e", subscriptionId: "sub", eventId: id, state, attempt: 1, lastCode: state, snapshot: { ...scope }, createdAt, updatedAt: createdAt, ...patch });
beforeEach(() => {
  fixture.calls = [];
  fixture.rows = { endpoints: [{ id: "e", companyId: "c", ...scope, enabled: false }], secrets: [{ id: "s", companyId: "c", scope: "company", status: "active", provider: "local_encrypted", deletedAt: null }],
    versions: [{ secretId: "s", version: 1, status: "current", revokedAt: null }], providers: [], subscriptions: [{ id: "sub", companyId: "c", eventType: "manual.test" }], deliveries: [], reviews: [] };
});
describe("notification verification reads (query fixture; no database/provider)", () => {
  it("returns latest failure rather than an old accepted row, beyond 100 unrelated deliveries", async () => {
    fixture.rows.deliveries = [delivery("old", "accepted"), delivery("latest", "rejected", new Date(time.getTime() + 1)), ...Array.from({ length: 120 }, (_, i) => delivery(`other-${i}`, "accepted", new Date(time.getTime() + 100 + i), { endpointId: "another" }))];
    const result = await notificationVerification(database()).read("c", "e");
    expect(result.latestTest).toMatchObject({ id: "latest", state: "rejected", scopeMatches: true });
    expect(result).toMatchObject({ machineVerified: false, endpointEnabled: false, credentialStatus: "metadata_active" });
    expect(result).not.toHaveProperty("liveVerified");
  });
  it("keeps a new pending test and does not infer live verification from old human accepted", async () => {
    fixture.rows.deliveries = [delivery("a", "pending")];
    fixture.rows.reviews = [{ id: "r", companyId: "c", deliveryId: "a", outcome: "accepted", evidence: "human report", createdAt: time }];
    expect((await notificationVerification(database()).read("c", "e")).latestTest).toMatchObject({ state: "pending", review: { outcome: "accepted" } });
  });
  it("does not query foreign endpoint resources", async () => {
    await expect(notificationVerification(database()).read("foreign", "e")).rejects.toMatchObject({ status: 404 });
    expect(fixture.calls).toEqual(["endpoints"]);
  });
  it("does not reuse prior config or credential epoch", async () => {
    fixture.rows.deliveries = [delivery("prior", "accepted", time, { snapshot: { ...scope, configVersion: 1 } }), delivery("stale", "accepted", time, { snapshot: { ...scope, verificationEpoch: 1 } })];
    expect((await notificationVerification(database()).read("c", "e")).latestTest).toMatchObject({ id: "stale", scopeMatches: false });
    delete fixture.rows.deliveries[1].snapshot.verificationEpoch;
    expect((await notificationVerification(database()).read("c", "e")).latestTest?.scopeMatches).toBe(false);
  });
  it.each(["disabled", "destroyed"])("shows %s pinned credential as unavailable", async status => {
    fixture.rows.versions[0].status = status;
    expect((await notificationVerification(database()).read("c", "e")).credentialStatus).toBe("unavailable");
  });
  it("does not claim a mutable external latest reference is an immutable account", async () => {
    Object.assign(fixture.rows.secrets[0], { provider: "aws_secrets_manager", providerConfigId: "p" });
    fixture.rows.providers = [{ id: "p", companyId: "c", provider: "aws_secrets_manager", status: "ready" }];
    expect((await notificationVerification(database()).read("c", "e")).credentialStatus).toBe("unpinned_external");
    fixture.rows.versions[0].providerVersionRef = "immutable-provider-version";
    expect((await notificationVerification(database()).read("c", "e")).credentialStatus).toBe("metadata_active");
  });
});
