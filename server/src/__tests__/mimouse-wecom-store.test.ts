import { describe, expect, it, vi } from "vitest";
import { companies, type Db } from "@paperclipai/db";
import { wecomFeedbackService, type WecomLease } from "../services/mimouse-wecom.js";
import type { WecomStopReason } from "../services/mimouse-wecom/protocol.js";

const lease: WecomLease = { companyId: "22222222-2222-4222-8222-222222222222", id: "33333333-3333-4333-8333-333333333333",
  token: "44444444-4444-4444-8444-444444444444", activationToken: "66666666-6666-4666-8666-666666666666", config: { transport: "long_connection", botId: "test-bot", product: "test",
    allowedGroupIds: ["test-group"], allowedDirectSenderIds: [], secret: { secretId: "55555555-5555-4555-8555-555555555555", version: 1 } } };
function mockDb() {
  const forLock = vi.fn().mockResolvedValue([]);
  const companyFor = vi.fn().mockResolvedValue([{ status: "active" }]);
  const select = vi.fn(() => ({ from: (table: unknown) => ({ where: () => ({ for: table === companies ? companyFor : forLock }) }) }));
  const returning = vi.fn().mockResolvedValue([]);
  const set = vi.fn(() => ({ where: () => ({ returning }) }));
  const update = vi.fn(() => ({ set }));
  const insert = vi.fn().mockImplementation(() => ({ values: vi.fn().mockResolvedValue(undefined) }));
  const execute = vi.fn().mockResolvedValue(undefined);
  const tx = { select, update, insert, execute };
  const db = { update, transaction: (fn: (value: typeof tx) => unknown) => fn(tx) } as unknown as Db;
  return { db, select, update, insert, set, forLock, returning, companyFor, execute };
}
describe("WeCom durable store fail-closed seams (no database or sockets)", () => {
  it("retains a transient transport gap without enabling or renewing the lease", async () => {
    const mock = mockDb(); mock.forLock.mockResolvedValue([{ config: lease.config }]);
    mock.returning.mockResolvedValue([{ id: lease.id }]);
    expect(await wecomFeedbackService(mock.db).markGap(lease)).toBe(true);
    expect(mock.set).toHaveBeenCalledWith({ gapDetected: true, state: "reconnecting", updatedAt: expect.any(Date) });
  });
  it("does not renew a missing/expired/disabled lease", async () => {
    const mock = mockDb();
    expect(await wecomFeedbackService(mock.db).renew(lease)).toBe(false);
    expect(mock.update).not.toHaveBeenCalled();
  });
  it("does not acquire when a global reservation is already leased", async () => {
    const mock = mockDb();
    expect(await wecomFeedbackService(mock.db).acquire(lease.companyId, lease.id)).toBeNull();
    expect(mock.update).not.toHaveBeenCalled();
  });
  it("commits a disabled gap status when the pinned credential was revoked before acquire", async () => {
    const mock = mockDb();
    mock.forLock.mockResolvedValueOnce([{ config: lease.config, activationToken: lease.activationToken, leaseToken: null }]).mockResolvedValue([]);
    const values = vi.fn().mockResolvedValue(undefined);
    mock.insert.mockReturnValue({ values });
    expect(await wecomFeedbackService(mock.db).acquire(lease.companyId, lease.id)).toBeNull();
    expect(mock.set).toHaveBeenCalledWith(expect.objectContaining({ enabled: false, state: "revoked", gapDetected: true, leaseToken: null }));
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ action: "feedback.wecom.stopped", details: { provider: "wecom_smart_bot", receiveOnly: true } }));
  });
  it("rejects persistence before reading payload when fencing denies ownership", async () => {
    const mock = mockDb();
    await expect(wecomFeedbackService(mock.db).persist(lease, {} as never)).rejects.toMatchObject({ status: 409 });
    expect(mock.insert).not.toHaveBeenCalled();
  });
  it("redacts known credentials in saved product attribution without trusting payload product", async () => {
    const mock = mockDb();
    mock.forLock.mockResolvedValueOnce([{ id: lease.id, companyId: lease.companyId, config: { ...lease.config, product: "suite opaque-credential" }, botHash: "a".repeat(64), imported: 0 }])
      .mockResolvedValueOnce([{ scope: "company", status: "active", deletedAt: null }])
      .mockResolvedValueOnce([{ status: "current", revokedAt: null }]);
    mock.returning.mockResolvedValue([{ id: lease.id }]);
    const values = vi.fn(() => ({ onConflictDoNothing: () => ({ returning: async () => [{ id: lease.id }] }) }));
    mock.insert.mockReturnValue({ values });
    await expect(wecomFeedbackService(mock.db).persist(lease, { sourceKind: "wecom_smart_bot", sourceInstance: "ignored", externalId: "event-1",
      title: "feedback", text: "message [REDACTED]", product: "malicious attribution", softwareVersion: "", commitSha: null, traceId: null,
      occurredAt: "2026-10-26T00:00:00.000Z" }, undefined, "opaque-credential")).resolves.toBe(true);
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ product: "suite [REDACTED]", redacted: true, ingestionMode: "provider_push", companyId: lease.companyId }));
    expect(JSON.stringify(values.mock.calls)).not.toContain("opaque-credential");
  });
  it("cancellation rejects before touching the database", async () => {
    const mock = mockDb(), abort = new AbortController(); abort.abort();
    await expect(wecomFeedbackService(mock.db).persist(lease, {} as never, abort.signal)).rejects.toBeDefined();
    expect(mock.select).not.toHaveBeenCalled(); expect(mock.insert).not.toHaveBeenCalled();
  });
  it.each<WecomStopReason>(["cancelled", "transport", "displaced", "authentication", "revoked", "budget_exhausted", "protocol", "overflow"])
    ("terminal %s requires explicit operator re-enable", async reason => {
      const mock = mockDb();
      await wecomFeedbackService(mock.db).release(lease, reason);
      expect(mock.set).toHaveBeenCalledWith(expect.objectContaining({ enabled: false, leaseToken: null, leaseExpiresAt: null, gapDetected: true, state: reason }));
      expect(mock.insert).not.toHaveBeenCalled(); // stale lease cannot emit an audit event
    });
});

describe("company lifecycle is authoritative inside the durable transaction", () => {
  it.each(["paused", "archived"])("stops and commits %s company rejection at acquire/renew/persist/credential boundaries", async status => {
    for (const boundary of ["acquire", "renew", "persist", "resolveCredential", "markGap", "markAuthenticated"] as const) {
      const mock = mockDb(); mock.companyFor.mockResolvedValue([{ status }]);
      mock.forLock.mockResolvedValue([{ ...lease, enabled: true, config: lease.config }]);
      const service = wecomFeedbackService(mock.db);
      if (boundary === "acquire") expect(await service.acquire(lease.companyId, lease.id)).toBeNull();
      else if (boundary === "renew" || boundary === "markGap" || boundary === "markAuthenticated") expect(await service[boundary](lease)).toBe(false);
      else if (boundary === "persist") await expect(service.persist(lease, {} as never)).rejects.toMatchObject({ status: 409 });
      else await expect(service.resolveCredential(lease)).rejects.toMatchObject({ status: 409 });
      expect(mock.set).toHaveBeenCalledWith(expect.objectContaining({ enabled: false, state: "company_inactive", gapDetected: true, leaseToken: null }));
      // Only the fixed stopped audit is inserted: no inbox or received audit.
      expect(mock.insert).toHaveBeenCalledTimes(1);
      const auditValues = mock.insert.mock.results[0].value.values;
      expect(auditValues).toHaveBeenCalledWith(expect.objectContaining({ action: "feedback.wecom.stopped" }));
      expect(mock.forLock).toHaveBeenCalledTimes(1); // credential rows were never read
    }
  });
  it.each(["paused", "archived"])("blocks new config, edits and enabling in %s company", async status => {
    const mock = mockDb(); mock.companyFor.mockResolvedValue([{ status }]);
    const service = wecomFeedbackService(mock.db), actor = { actorType: "user" as const, actorId: "admin" };
    await expect(service.create(lease.companyId, lease.config, actor)).rejects.toMatchObject({ status: 409 });
    await expect(service.update(lease.companyId, lease.id, lease.config, actor)).rejects.toMatchObject({ status: 409 });
    await expect(service.setEnabled(lease.companyId, lease.id, true, actor)).rejects.toMatchObject({ status: 409 });
    expect(mock.insert).not.toHaveBeenCalled(); expect(mock.update).not.toHaveBeenCalled();
  });
  it("an active lease cannot renew after company pause", async () => {
    const mock = mockDb(), service = wecomFeedbackService(mock.db);
    mock.forLock.mockResolvedValueOnce([{ config: lease.config }])
      .mockResolvedValueOnce([{ scope: "company", status: "active", deletedAt: null }])
      .mockResolvedValueOnce([{ status: "current", revokedAt: null }]);
    mock.returning.mockResolvedValue([{ id: lease.id }]);
    expect(await service.renew(lease)).toBe(true);
    mock.companyFor.mockResolvedValue([{ status: "paused" }]);
    mock.forLock.mockResolvedValue([{ config: lease.config }]);
    expect(await service.renew(lease)).toBe(false);
    expect(mock.set).toHaveBeenLastCalledWith(expect.objectContaining({ state: "company_inactive", enabled: false }));
  });
});

it("ordinary company admin cannot reserve a global bot with any dummy secret reference", async () => {
  const mock = mockDb(); // active company but no current instance administrator role
  await expect(wecomFeedbackService(mock.db).create(lease.companyId, lease.config,
    { actorType: "user", actorId: "company-admin" })).rejects.toMatchObject({ status: 403 });
  expect(mock.forLock).toHaveBeenCalledTimes(1); // role lookup only; no credential ownership proof inferred
  expect(mock.insert).not.toHaveBeenCalled();
  expect(mock.update).not.toHaveBeenCalled();
});
it("sets transaction-local statement and lock budgets even on a denied lease", async () => {
  const mock = mockDb(); await wecomFeedbackService(mock.db).renew(lease);
  expect(mock.execute).toHaveBeenCalledTimes(1);
});

it("an expired retained lease never creates a fresh run budget", async () => {
  const mock = mockDb(); mock.forLock.mockResolvedValue([{ config: lease.config, activationToken: lease.activationToken, leaseToken: lease.token }]);
  expect(await wecomFeedbackService(mock.db).acquire(lease.companyId, lease.id)).toBeNull();
  expect(mock.set).toHaveBeenCalledWith(expect.objectContaining({ enabled: false, state: "interrupted", gapDetected: true, leaseToken: null }));
});
it.each([false, true])("enabled=%s preserves explicit activation idempotency", async alreadyEnabled => {
  const mock = mockDb(), now = new Date();
  const row = { ...lease, enabled: alreadyEnabled, activationToken: lease.activationToken, createdAt: now, updatedAt: now };
  mock.forLock.mockResolvedValueOnce([row])
    .mockResolvedValueOnce([{ scope: "company", status: "active" }])
    .mockResolvedValueOnce([{ status: "current", revokedAt: null }]);
  mock.returning.mockResolvedValue([{ ...row, enabled: true }]);
  await wecomFeedbackService(mock.db).setEnabled(lease.companyId, lease.id, true, { actorType: "user", actorId: "operator" });
  if (alreadyEnabled) expect(mock.update).not.toHaveBeenCalled();
  else {
    expect(mock.set).toHaveBeenCalledWith(expect.objectContaining({ enabled: true, activationToken: expect.stringMatching(/^[a-f0-9-]{36}$/) }));
    expect(mock.set).not.toHaveBeenCalledWith(expect.objectContaining({ activationToken: lease.activationToken }));
  }
});
