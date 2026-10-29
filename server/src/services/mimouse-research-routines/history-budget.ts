import type { Db } from "@paperclipai/db";
import { HttpError } from "../../errors.js";
export const historyUnavailable = () => new HttpError(503, "Research history temporarily unavailable; retry");
/** Wrap every query, including canonical ACL helpers, in the same read budget.
 * No hidden partial page is returned on exhaustion. Query-local timeouts also
 * bound one blocked statement; the outer deadline includes pool acquisition. */
export function historyReadBudget(db: Db, deadline: number) {
  let reads = 0;
  const check = () => { if (Date.now() >= deadline) throw historyUnavailable(); };
  const wrap = (value: object): object => new Proxy(value, { get(target, key, receiver) {
    const member = Reflect.get(target, key, receiver);
    if (typeof member !== "function") return member;
    if (key === "then") return (resolve: (rows: unknown) => unknown, reject: (error: unknown) => unknown) => {
      const run = async () => {
        check();
        const result = await member.call(target, (rows: unknown) => rows);
        reads += Array.isArray(result) ? result.length : 1;
        if (reads > 4096) throw historyUnavailable();
        check(); return result;
      };
      return run().then(resolve, reject);
    };
    return (...args: unknown[]) => {
      check();
      const result = member.apply(target, args);
      return result && typeof result === "object" && !(result instanceof Promise) ? wrap(result) : result;
    };
  } });
  return { db: wrap(db) as Db, check };
}
export async function boundedHistory<T>(work: (deadline: number) => Promise<T>): Promise<T> {
  const deadline = Date.now() + 5000;
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([work(deadline), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(historyUnavailable()), 5000);
    })]);
  } catch (error) {
    const code = (error as { code?: string; cause?: { code?: string } }).code ?? (error as { cause?: { code?: string } }).cause?.code;
    if (code === "57014" || code === "55P03") throw historyUnavailable();
    throw error;
  } finally { clearTimeout(timer!); }
}
