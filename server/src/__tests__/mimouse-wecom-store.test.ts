import { describe, expect, it, vi } from "vitest";
import type { Db } from "@paperclipai/db";
import { wecomFeedbackService, type WecomLease } from "../services/mimouse-wecom.js";
import type { WecomStopReason } from "../services/mimouse-wecom/protocol.js";

const lease: WecomLease = { companyId: "22222222-2222-4222-8222-222222222222", id: "33333333-3333-4333-8333-333333333333",
  token: "44444444-4444-4444-8444-444444444444", config: { transport: "long_connection", botId: "test-bot", product: "test",
    allowedGroupIds: ["test-group"], allowedDirectSenderIds: [], secret: { secretId: "55555555-5555-4555-8555-555555555555", version: 1 } } };
function mockDb() {
  const forLock = vi.fn().mockResolvedValue([]);
  const select = vi.fn(() => ({ from: () => ({ where: () => ({ for: forLock }) }) }));
  const returning = vi.fn().mockResolvedValue([]);
  const set = vi.fn(() => ({ where: () => ({ returning }) }));
  const update = vi.fn(() => ({ set }));
  const insert = vi.fn();
  const tx = { select, update, insert };
  const db = { update, transaction: (fn: (value: typeof tx) => unknown) => fn(tx) } as unknown as Db;
  return { db, select, update, insert, set, forLock, returning };
}
describe("WeCom durable store fail-closed seams (no database or sockets)", () => {
  it("retains a transient transport gap without enabling or renewing the lease", async () => {
    const mock = mockDb();
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
    mock.forLock.mockResolvedValueOnce([{ config: lease.config }]).mockResolvedValue([]);
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
