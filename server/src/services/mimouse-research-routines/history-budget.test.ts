import { afterEach, expect, it, vi } from "vitest";
import type { Db } from "@paperclipai/db";
import { boundedHistory, historyReadBudget } from "./history-budget.js";
afterEach(() => vi.useRealTimers());
it("aborts over 4096 linked reads instead of returning a partial page", async () => {
  const result = Array.from({ length: 2049 }, () => ({}));
  const query = { from() { return this; }, then(resolve: (rows: unknown[]) => unknown) { return Promise.resolve(result).then(resolve); } };
  const { db } = historyReadBudget({ select: () => query } as unknown as Db, Date.now() + 5000);
  await db.select().from({} as never);
  await expect(db.select().from({} as never)).rejects.toMatchObject({ status: 503 });
});
it("deadline includes waiting for a transaction connection", async () => {
  vi.useFakeTimers();
  const result = boundedHistory(() => new Promise(() => {}));
  const rejected = expect(result).rejects.toMatchObject({ status: 503 });
  await vi.advanceTimersByTimeAsync(5000); await rejected;
});
it.each(["57014", "55P03"])("maps PostgreSQL budget %s to retryable 503", async code => {
  await expect(boundedHistory(async () => { throw { cause: { code } }; })).rejects.toMatchObject({ status: 503 });
});
