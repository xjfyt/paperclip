import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createRequire } from "node:module";
import { createDb, agents, budgetPolicies, budgetIncidents, costEvents, companySecrets, mimouseNotificationEndpoints as endpoints, mimouseNotificationSubscriptions as subscriptions, mimouseNotificationDeliveries as deliveries } from "../../packages/db/src/index.js";
const require = createRequire(new URL("../../server/package.json", import.meta.url));
const { eq } = await import(require.resolve("drizzle-orm"));
test("budget incident and localized outbox commit once under the accounting transaction", async ({ request }) => {
  const company = await (await request.post("/api/companies", { data: { name: `budget-notify ${Date.now()}` } })).json();
  const db = createDb("postgres://paperclip:paperclip@127.0.0.1:54329/paperclip");
  const previous = process.env.PAPERCLIP_NOTIFICATIONS_ENABLED; process.env.PAPERCLIP_NOTIFICATIONS_ENABLED = "true";
  try {
    const [agent] = await db.insert(agents).values({ companyId: company.id, name: "PRIVATE_AGENT_NAME", role: "engineer", status: "active", adapterType: "process", adapterConfig: {}, runtimeConfig: {}, permissions: {} }).returning();
    const [secret] = await db.insert(companySecrets).values({ companyId: company.id, name: "fixture", key: randomUUID() }).returning();
    const [endpoint] = await db.insert(endpoints).values({ companyId: company.id, name: "budget fixture", kind: "wecom_webhook", config: {}, secretRef: secret.id, secretVersion: 1, targetKey: randomUUID(), enabled: true }).returning();
    await db.insert(subscriptions).values({ companyId: company.id, endpointId: endpoint.id, eventType: "budget.threshold_reached", locale: "ja" });
    await db.insert(budgetPolicies).values({ companyId: company.id, scopeType: "agent", scopeId: agent.id, metric: "billed_cents", windowKind: "calendar_month_utc", amount: 100, warnPercent: 80, hardStopEnabled: true, notifyEnabled: true, isActive: true });
    const response = await request.post(`/api/companies/${company.id}/cost-events`, { data: { agentId: agent.id, provider: "fixture", biller: "fixture", billingType: "metered_api", model: "fixture", costCents: 80, occurredAt: new Date().toISOString() } });
    expect(response.ok(), await response.text()).toBeTruthy();
    // A second below-limit cost stays in the same incident window.
    const second = await request.post(`/api/companies/${company.id}/cost-events`, { data: { agentId: agent.id, provider: "fixture", biller: "fixture", billingType: "metered_api", model: "fixture", costCents: 1, occurredAt: new Date().toISOString() } });
    expect(second.ok(), await second.text()).toBeTruthy();
    expect(await db.select().from(budgetIncidents).where(eq(budgetIncidents.companyId, company.id))).toHaveLength(1);
    const rows = await db.select().from(deliveries).where(eq(deliveries.companyId, company.id)); expect(rows).toHaveLength(1);
    expect(rows[0].snapshot.title).toBe("予算のしきい値に達しました"); expect(rows[0].snapshot.locale).toBe("ja");
    expect(JSON.stringify(rows)).not.toContain("PRIVATE_AGENT_NAME");
  } finally { await db.update(endpoints).set({ enabled: false }).where(eq(endpoints.companyId, company.id)); if (previous === undefined) delete process.env.PAPERCLIP_NOTIFICATIONS_ENABLED; else process.env.PAPERCLIP_NOTIFICATIONS_ENABLED = previous; await db.$client.end({ timeout: 1 }); }
});
