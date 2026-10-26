import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import {
  closeHttpListenerForShutdown,
  coordinateHeartbeatSchedulerShutdown,
  createCoordinatedServerShutdown,
  drainRunExecutionFinalizersForShutdown,
  finalizeServerShutdown,
  loadWithoutCoordinatedShutdownSignalHooks,
} from "./shutdown.js";

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function stubLogger() {
  return { info: vi.fn(), error: vi.fn() };
}

describe("finalizeServerShutdown", () => {
  it("awaits the setup-token cleanup before the database stop and the process exit", async () => {
    const order: string[] = [];
    // The held promise models the setup-token session cancellation and its
    // sandbox lease release. The teardown must not continue while it is pending.
    const release = deferred();
    const shutdownAppServices = vi.fn(async () => {
      order.push("appServices:start");
      await release.promise;
      order.push("appServices:settled");
    });
    const closeHttpListener = vi.fn(async () => {
      order.push("listener:close");
    });
    const closeDatabase = vi.fn(async () => {
      order.push("database:close");
    });
    const stopEmbeddedPostgres = vi.fn(async () => {
      order.push("postgres:stop");
    });
    const shutdownInstrumentation = vi.fn(async () => {
      order.push("instrumentation:flush");
    });
    const shutdownSentry = vi.fn(async () => {
      order.push("sentry:flush");
    });

    let exited = false;
    const finalize = finalizeServerShutdown({
      signal: "SIGTERM",
      shutdownAppServices,
      closeHttpListener,
      closeDatabase,
      stopEmbeddedPostgres,
      shutdownInstrumentation,
      shutdownSentry,
      log: stubLogger(),
    }).then(() => {
      // This models the caller's `process.exit(0)` continuation.
      exited = true;
      order.push("exit");
    });

    // The cleanup is in flight. The database stop, the instrumentation flush,
    // and the process exit continuation must all wait for it to settle.
    await vi.waitFor(() => expect(shutdownAppServices).toHaveBeenCalledOnce());
    // The listener already closed: requests are drained while every service
    // is still available, and nothing after this point can be reached.
    expect(closeHttpListener).toHaveBeenCalledOnce();
    expect(closeDatabase).not.toHaveBeenCalled();
    expect(stopEmbeddedPostgres).not.toHaveBeenCalled();
    expect(shutdownInstrumentation).not.toHaveBeenCalled();
    expect(exited).toBe(false);

    release.resolve();
    await finalize;

    expect(exited).toBe(true);
    expect(order).toEqual([
      "listener:close",
      "appServices:start",
      "appServices:settled",
      "database:close",
      "postgres:stop",
      "instrumentation:flush",
      "sentry:flush",
      "exit",
    ]);
  });

  it("keeps the teardown durable and still exits when the setup-token release fails", async () => {
    const order: string[] = [];
    // The held promise rejects, which models a lease release that failed. The
    // reaper owns the durable retry, so the teardown must log the failure and
    // continue rather than swallow it or block the exit.
    const release = deferred();
    const releaseError = new Error("lease release failed");
    const shutdownAppServices = vi.fn(async () => {
      await release.promise;
    });
    const stopEmbeddedPostgres = vi.fn(async () => {
      order.push("postgres:stop");
    });
    const shutdownInstrumentation = vi.fn(async () => {
      order.push("instrumentation:flush");
    });
    const shutdownSentry = vi.fn(async () => undefined);
    const log = stubLogger();

    let exited = false;
    const finalize = finalizeServerShutdown({
      signal: "SIGTERM",
      shutdownAppServices,
      stopEmbeddedPostgres,
      shutdownInstrumentation,
      shutdownSentry,
      log,
    }).then(() => {
      exited = true;
    });

    await vi.waitFor(() => expect(shutdownAppServices).toHaveBeenCalledOnce());
    expect(stopEmbeddedPostgres).not.toHaveBeenCalled();
    expect(exited).toBe(false);

    release.reject(releaseError);
    await finalize;

    // The teardown surfaced the failure in the log, then finished the ordered
    // teardown and reached the exit continuation.
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: releaseError, signal: "SIGTERM" }),
      expect.any(String),
    );
    expect(order).toEqual(["postgres:stop", "instrumentation:flush"]);
    expect(exited).toBe(true);
  });

  it("logs a failed database close and still stops the provider and exits", async () => {
    const order: string[] = [];
    const closeError = new Error("pool end timed out");
    const closeDatabase = vi.fn(async () => {
      order.push("database:close");
      throw closeError;
    });
    const stopEmbeddedPostgres = vi.fn(async () => {
      order.push("postgres:stop");
    });
    const log = stubLogger();

    await finalizeServerShutdown({
      signal: "SIGTERM",
      shutdownAppServices: vi.fn(async () => undefined),
      closeDatabase,
      stopEmbeddedPostgres,
      shutdownInstrumentation: vi.fn(async () => undefined),
      shutdownSentry: vi.fn(async () => undefined),
      log,
    });

    expect(order).toEqual(["database:close", "postgres:stop"]);
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: closeError, signal: "SIGTERM" }),
      "Database client shutdown failed",
    );
  });

  it("waits for pending run-failure reports before the database stop and the Sentry flush", async () => {
    const order: string[] = [];
    const release = deferred();
    const drainPendingRunFailureReports = vi.fn(async () => {
      order.push("runFailureReports:start");
      await release.promise;
      order.push("runFailureReports:settled");
    });
    const closeDatabase = vi.fn(async () => {
      order.push("database:close");
    });
    const shutdownSentry = vi.fn(async () => {
      order.push("sentry:flush");
    });

    const finalize = finalizeServerShutdown({
      signal: "SIGTERM",
      shutdownAppServices: vi.fn(async () => undefined),
      drainPendingRunFailureReports,
      closeDatabase,
      stopEmbeddedPostgres: null,
      shutdownInstrumentation: vi.fn(async () => undefined),
      shutdownSentry,
      log: stubLogger(),
    });

    await vi.waitFor(() => expect(drainPendingRunFailureReports).toHaveBeenCalledOnce());
    expect(closeDatabase).not.toHaveBeenCalled();
    expect(shutdownSentry).not.toHaveBeenCalled();

    release.resolve();
    await finalize;

    expect(order).toEqual([
      "runFailureReports:start",
      "runFailureReports:settled",
      "database:close",
      "sentry:flush",
    ]);
  });

  it("logs a failed run-failure report drain and still stops the database and exits", async () => {
    const drainError = new Error("drain failed");
    const drainPendingRunFailureReports = vi.fn(async () => {
      throw drainError;
    });
    const closeDatabase = vi.fn(async () => undefined);
    const log = stubLogger();

    await finalizeServerShutdown({
      signal: "SIGTERM",
      shutdownAppServices: vi.fn(async () => undefined),
      drainPendingRunFailureReports,
      closeDatabase,
      stopEmbeddedPostgres: null,
      shutdownInstrumentation: vi.fn(async () => undefined),
      shutdownSentry: vi.fn(async () => undefined),
      log,
    });

    expect(closeDatabase).toHaveBeenCalledOnce();
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: drainError, signal: "SIGTERM" }),
      "run-failure report drain failed",
    );
  });

  it("skips the database stop when no embedded PostgreSQL runs in this process", async () => {
    const shutdownAppServices = vi.fn(async () => undefined);
    const shutdownInstrumentation = vi.fn(async () => undefined);
    const shutdownSentry = vi.fn(async () => undefined);
    const log = stubLogger();

    await finalizeServerShutdown({
      signal: "SIGINT",
      shutdownAppServices,
      stopEmbeddedPostgres: null,
      shutdownInstrumentation,
      shutdownSentry,
      log,
    });

    expect(shutdownAppServices).toHaveBeenCalledOnce();
    expect(shutdownInstrumentation).toHaveBeenCalledOnce();
    expect(log.info).not.toHaveBeenCalled();
  });
});

describe("closeHttpListenerForShutdown", () => {
  function fakeServer(input: { listening: boolean; closeDelayMs?: number | null }) {
    const closeIdleConnections = vi.fn();
    const closeAllConnections = vi.fn();
    const close = vi.fn((callback?: (err?: Error) => void) => {
      if (input.closeDelayMs === null) return;
      setTimeout(() => callback?.(), input.closeDelayMs ?? 0);
    });
    return { listening: input.listening, close, closeIdleConnections, closeAllConnections };
  }

  it("stops accepting, closes idle keep-alive sockets, and resolves once the listener closed", async () => {
    const server = fakeServer({ listening: true, closeDelayMs: 0 });
    await expect(
      closeHttpListenerForShutdown({ server, signal: "SIGTERM", timeoutMs: 1_000, log: stubLogger() }),
    ).resolves.toBe("closed");
    expect(server.close).toHaveBeenCalledOnce();
    expect(server.closeIdleConnections).toHaveBeenCalledOnce();
    expect(server.closeAllConnections).not.toHaveBeenCalled();
  });

  it("closes the remaining connections when the drain outlives the grace period", async () => {
    vi.useFakeTimers();
    try {
      const server = fakeServer({ listening: true, closeDelayMs: null });
      const log = stubLogger();
      const pending = closeHttpListenerForShutdown({ server, signal: "SIGINT", timeoutMs: 250, log });
      await vi.advanceTimersByTimeAsync(250);
      await expect(pending).resolves.toBe("timed_out");
      expect(server.closeAllConnections).toHaveBeenCalledOnce();
      expect(log.info).toHaveBeenCalledWith(
        expect.objectContaining({ timeoutMs: 250 }),
        expect.stringContaining("timed out"),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("does nothing when the listener was never bound", async () => {
    const server = fakeServer({ listening: false });
    await expect(
      closeHttpListenerForShutdown({ server, signal: "SIGTERM", log: stubLogger() }),
    ).resolves.toBe("not_listening");
    expect(server.close).not.toHaveBeenCalled();
  });
});

describe("drainRunExecutionFinalizersForShutdown", () => {
  it("awaits bounded execution finalizers", async () => {
    const release = deferred();
    const drain = vi.fn(() => release.promise);
    const pending = drainRunExecutionFinalizersForShutdown({
      signal: "SIGTERM",
      drain,
      timeoutMs: 1_000,
      log: stubLogger(),
    });
    await vi.waitFor(() => expect(drain).toHaveBeenCalledOnce());
    release.resolve();
    await expect(pending).resolves.toBe("drained");
  });

  it("returns after the bounded timeout when an adopted run remains active", async () => {
    vi.useFakeTimers();
    try {
      const log = stubLogger();
      const pending = drainRunExecutionFinalizersForShutdown({
        signal: "SIGINT",
        drain: () => new Promise<void>(() => undefined),
        timeoutMs: 250,
        log,
      });
      await vi.advanceTimersByTimeAsync(250);
      await expect(pending).resolves.toBe("timed_out");
      expect(log.info).toHaveBeenCalledWith(
        expect.objectContaining({ timeoutMs: 250 }),
        expect.stringContaining("timed out"),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("loadWithoutCoordinatedShutdownSignalHooks", () => {
  it("removes the eager signal handlers from the real embedded-postgres import", async () => {
    const before = {
      SIGINT: process.rawListeners("SIGINT"),
      SIGTERM: process.rawListeners("SIGTERM"),
    };
    const moduleName = "embedded-postgres";

    await loadWithoutCoordinatedShutdownSignalHooks(() => import(moduleName));

    expect(process.rawListeners("SIGINT")).toEqual(before.SIGINT);
    expect(process.rawListeners("SIGTERM")).toEqual(before.SIGTERM);
  });

  it("keeps the database available for a marker-backed SIGTERM snapshot", async () => {
    const signalTarget = new EventEmitter();
    const preexistingSignalListener = vi.fn();
    signalTarget.on("SIGTERM", preexistingSignalListener);

    let databaseAvailable = true;
    const embeddedPostgresExitHook = vi.fn(() => {
      databaseAvailable = false;
    });
    await loadWithoutCoordinatedShutdownSignalHooks(
      async () => {
        signalTarget.on("SIGINT", embeddedPostgresExitHook);
        signalTarget.on("SIGTERM", embeddedPostgresExitHook);
        return { default: class EmbeddedPostgres {} };
      },
      signalTarget,
    );

    let shutdown: Promise<unknown> | null = null;
    let snapshotCaptured = false;
    signalTarget.once("SIGTERM", () => {
      shutdown = coordinateHeartbeatSchedulerShutdown({
        signal: "SIGTERM",
        prepareHotRestartShutdown: async () => {
          // This models the real failure path: a valid intent exists, and the
          // snapshot must query embedded PostgreSQL after SIGTERM is delivered.
          expect(databaseAvailable).toBe(true);
          snapshotCaptured = true;
          return { mode: "hot_restart" as const, skipDrain: true };
        },
        waitForHeartbeatSchedulerIdle: vi.fn(async () => undefined),
      });
    });

    signalTarget.emit("SIGTERM");
    await shutdown;

    expect(preexistingSignalListener).toHaveBeenCalledOnce();
    expect(embeddedPostgresExitHook).not.toHaveBeenCalled();
    expect(snapshotCaptured).toBe(true);
  });
});

describe("coordinateHeartbeatSchedulerShutdown", () => {
  it("quiesces active scheduler work before capturing a hot-restart snapshot", async () => {
    let snapshotCaptured = false;
    let releaseScheduler!: () => void;
    const schedulerIdle = new Promise<void>((resolve) => {
      releaseScheduler = resolve;
    });
    const waitForHeartbeatSchedulerIdle = vi.fn(() => schedulerIdle);

    const shutdown = coordinateHeartbeatSchedulerShutdown({
      signal: "SIGTERM",
      prepareHotRestartShutdown: vi.fn(async () => {
        snapshotCaptured = true;
        return { mode: "prepared" as const, skipDrain: true };
      }),
      waitForHeartbeatSchedulerIdle,
    });

    await vi.waitFor(() => expect(waitForHeartbeatSchedulerIdle).toHaveBeenCalledOnce());
    expect(snapshotCaptured).toBe(false);
    releaseScheduler();

    const result = await shutdown;
    expect(snapshotCaptured).toBe(true);
    expect(result).toEqual({
      hotRestart: { mode: "prepared", skipDrain: true },
      preparationError: null,
      waitedForSchedulerIdle: true,
    });
  });

  it("quiesces scheduler work before selecting server-stdio runs to drain", async () => {
    const waitForHeartbeatSchedulerIdle = vi.fn(async () => undefined);

    const result = await coordinateHeartbeatSchedulerShutdown({
      signal: "SIGTERM",
      prepareHotRestartShutdown: vi.fn(async () => ({
        mode: "acp_drain_required" as const,
        skipDrain: false,
        drainRunIds: ["acp-run"],
      })),
      waitForHeartbeatSchedulerIdle,
    });

    expect(waitForHeartbeatSchedulerIdle).toHaveBeenCalledOnce();
    expect(result).toEqual({
      hotRestart: {
        mode: "acp_drain_required",
        skipDrain: false,
        drainRunIds: ["acp-run"],
      },
      preparationError: null,
      waitedForSchedulerIdle: true,
    });
  });

  it("preserves the scheduler idle wait for normal graceful shutdown", async () => {
    let releaseScheduler!: () => void;
    const schedulerIdle = new Promise<void>((resolve) => {
      releaseScheduler = resolve;
    });
    const waitForHeartbeatSchedulerIdle = vi.fn(() => schedulerIdle);
    let settled = false;

    const shutdown = coordinateHeartbeatSchedulerShutdown({
      signal: "SIGTERM",
      prepareHotRestartShutdown: vi.fn(async () => ({
        mode: "not_requested" as const,
        skipDrain: false,
      })),
      waitForHeartbeatSchedulerIdle,
    }).finally(() => {
      settled = true;
    });

    await vi.waitFor(() => expect(waitForHeartbeatSchedulerIdle).toHaveBeenCalledOnce());
    expect(settled).toBe(false);

    releaseScheduler();

    await expect(shutdown).resolves.toEqual({
      hotRestart: { mode: "not_requested", skipDrain: false },
      preparationError: null,
      waitedForSchedulerIdle: true,
    });
  });

  it("waits for scheduler idle when hot-restart preparation is unavailable", async () => {
    const waitForHeartbeatSchedulerIdle = vi.fn(async () => undefined);

    const result = await coordinateHeartbeatSchedulerShutdown({
      signal: "SIGTERM",
      prepareHotRestartShutdown: null,
      waitForHeartbeatSchedulerIdle,
    });

    expect(waitForHeartbeatSchedulerIdle).toHaveBeenCalledOnce();
    expect(result).toEqual({
      hotRestart: null,
      preparationError: null,
      waitedForSchedulerIdle: true,
    });
  });

  it("falls back to the scheduler idle wait when hot-restart preparation fails", async () => {
    const preparationError = new Error("snapshot failed");
    const waitForHeartbeatSchedulerIdle = vi.fn(async () => undefined);

    const result = await coordinateHeartbeatSchedulerShutdown({
      signal: "SIGTERM",
      prepareHotRestartShutdown: vi.fn(async () => {
        throw preparationError;
      }),
      waitForHeartbeatSchedulerIdle,
    });

    expect(waitForHeartbeatSchedulerIdle).toHaveBeenCalledOnce();
    expect(result).toEqual({
      hotRestart: null,
      preparationError,
      waitedForSchedulerIdle: true,
    });
  });
});

describe("createCoordinatedServerShutdown", () => {
  function fixture(overrides: { begin?: () => void; signalTarget?: EventEmitter } = {}) {
    const signalTarget = new EventEmitter();
    const drain = deferred();
    const finalize = deferred();
    const input = {
      signalTarget,
      begin: vi.fn(),
      drain: vi.fn(() => drain.promise),
      finalize: vi.fn(() => finalize.promise),
      exit: vi.fn(),
      log: stubLogger(),
      ...overrides,
    };
    return { input, drain, finalize, shutdown: createCoordinatedServerShutdown(input) };
  }

  it.each(["SIGINT", "SIGTERM"] as const)("joins repeated %s and the other signal to programmatic work", async (signal) => {
    const f = fixture();
    const other = signal === "SIGINT" ? "SIGTERM" : "SIGINT";
    const result = f.shutdown(signal);
    expect(f.input.begin).toHaveBeenCalledOnce();
    expect(f.input.drain).toHaveBeenCalledWith(signal);
    f.input.signalTarget.emit(signal);
    f.input.signalTarget.emit(signal);
    f.input.signalTarget.emit(other);
    expect(f.shutdown(other)).toBe(result);
    expect(f.input.finalize).not.toHaveBeenCalled();
    expect(f.input.exit).not.toHaveBeenCalled();
    f.drain.resolve();
    await Promise.resolve();
    expect(f.input.finalize).toHaveBeenCalledOnce();
    expect(f.input.finalize).toHaveBeenCalledWith(signal);
    expect(f.input.exit).not.toHaveBeenCalled();
    f.finalize.resolve();
    await result;
    expect(f.input.drain).toHaveBeenCalledOnce();
    expect(f.input.exit).toHaveBeenCalledExactlyOnceWith(0);
    expect(f.shutdown(other)).toBe(result);
    expect(f.input.signalTarget.listenerCount("SIGINT")).toBe(0);
    expect(f.input.signalTarget.listenerCount("SIGTERM")).toBe(0);
  });

  it.each(["SIGINT", "SIGTERM"] as const)("shares signal-first %s work with subsequent programmatic calls", async (signal) => {
    const f = fixture();
    f.input.signalTarget.emit(signal);
    const result = f.shutdown("SIGTERM");
    f.input.signalTarget.emit("SIGINT");
    f.input.signalTarget.emit("SIGTERM");
    f.drain.resolve();
    f.finalize.resolve();
    await result;
    expect(f.input.begin).toHaveBeenCalledOnce();
    expect(f.input.drain).toHaveBeenCalledExactlyOnceWith(signal);
    expect(f.input.finalize).toHaveBeenCalledExactlyOnceWith(signal);
    expect(f.input.exit).toHaveBeenCalledExactlyOnceWith(0);
  });

  it("removes only its listeners after programmatic completion and never exits", async () => {
    const target = new EventEmitter();
    const otherInt = vi.fn();
    const otherTerm = vi.fn();
    target.on("SIGINT", otherInt);
    target.once("SIGTERM", otherTerm);
    const f = fixture({ signalTarget: target });
    const later = vi.fn();
    target.on("SIGINT", later);
    const result = f.shutdown("SIGTERM");
    f.drain.resolve();
    f.finalize.resolve();
    await result;
    expect(target.listeners("SIGINT")).toEqual([otherInt, later]);
    expect(target.listeners("SIGTERM")).toEqual([otherTerm]);
    expect(f.input.exit).not.toHaveBeenCalled();
    expect(f.shutdown("SIGINT")).toBe(result);
  });

  it("publishes work before synchronous begin can reenter shutdown", async () => {
    let reentered: Promise<void> | undefined;
    const f = fixture({ begin: () => { reentered = f.shutdown("SIGTERM"); } });
    const result = f.shutdown("SIGINT");
    expect(reentered).toBe(result);
    f.drain.resolve();
    f.finalize.resolve();
    await result;
    expect(f.input.drain).toHaveBeenCalledOnce();
  });

  it.each(["begin", "drain"] as const)("retains %s failure until final cleanup settles, once for every caller", async (phase) => {
    const failure = new Error(`${phase} failed`);
    const f = fixture(phase === "begin" ? { begin: () => { throw failure; } } : {});
    const result = f.shutdown("SIGTERM");
    const rejected = expect(result).rejects.toBe(failure);
    if (phase === "drain") f.drain.reject(failure);
    await Promise.resolve();
    expect(f.input.finalize).toHaveBeenCalledOnce();
    let settled = false;
    void result.catch(() => { settled = true; });
    f.input.signalTarget.emit("SIGINT");
    f.input.signalTarget.emit("SIGTERM");
    expect(f.shutdown("SIGINT")).toBe(result);
    expect(settled).toBe(false);
    f.finalize.resolve();
    await rejected;
    expect(f.input.exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(f.input.log.error).toHaveBeenCalledOnce();
    expect(f.input.log.error.mock.calls[0]?.[0]).toMatchObject({ err: failure });
    expect(f.input.signalTarget.eventNames()).toEqual([]);
    expect(f.shutdown("SIGINT")).toBe(result);
    await expect(f.shutdown("SIGINT")).rejects.toBe(failure);
    expect(f.input.finalize).toHaveBeenCalledOnce();
  });

  it("preserves both drain and finalizer failures without replacing the first", async () => {
    const f = fixture();
    const first = new Error("drain");
    const second = new Error("finalize");
    const result = f.shutdown("SIGTERM");
    const observed = result.catch((error: unknown) => error);
    f.drain.reject(first);
    await Promise.resolve();
    f.finalize.reject(second);
    const error = await observed;
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toEqual([first, second]);
    expect(f.input.signalTarget.eventNames()).toEqual([]);
    expect(f.input.exit).not.toHaveBeenCalled();
  });

  it("returns finalizer-only failure unchanged", async () => {
    const f = fixture();
    const failure = new Error("finalize");
    const result = f.shutdown("SIGINT");
    const rejected = expect(result).rejects.toBe(failure);
    f.drain.resolve();
    await Promise.resolve();
    f.finalize.reject(failure);
    await rejected;
    expect(f.input.signalTarget.eventNames()).toEqual([]);
  });
});


it.skipIf(process.platform === "win32")("coordinates real repeated POSIX signals on one owned Node child", async () => {
  const source = new URL("./shutdown.ts", import.meta.url).href;
  const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
    import { createCoordinatedServerShutdown } from ${JSON.stringify(source)};
    let release;
    const drain = new Promise((resolve) => { release = resolve; });
    createCoordinatedServerShutdown({
      begin: () => process.send('begin'),
      drain: () => { process.send('drain'); return drain; },
      finalize: async () => { process.send('finalize'); },
      signalTarget: process,
      exit: (code) => process.send('exit:' + code, () => process.exit(code)),
      log: { info() {}, error() { process.send('error'); } },
    });
    process.on('SIGINT', () => process.send('signal:SIGINT'));
    process.on('SIGTERM', () => process.send('signal:SIGTERM'));
    process.on('message', () => release());
    process.send('ready');
  `], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
  const messages: unknown[] = [];
  let stderr = "";
  child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`Owned signal fixture timed out: ${stderr}`)), 4_000);
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal }));
      child.on("message", (message) => {
        messages.push(message);
        if (message === "ready" || message === "drain") child.kill("SIGINT");
        if (message === "signal:SIGINT" && messages.filter((m) => m === message).length === 2) {
          child.kill("SIGTERM");
        }
        if (message === "signal:SIGTERM") child.send("finish");
      });
    });
    expect(result, stderr).toEqual({ code: 0, signal: null });
    expect(messages.filter((m) => m === "begin")).toHaveLength(1);
    expect(messages.filter((m) => m === "drain")).toHaveLength(1);
    expect(messages.filter((m) => m === "finalize")).toHaveLength(1);
    expect(messages.filter((m) => m === "exit:0")).toHaveLength(1);
    expect(messages.filter((m) => m === "signal:SIGINT")).toHaveLength(2);
    expect(messages.filter((m) => m === "signal:SIGTERM")).toHaveLength(1);
    expect(messages).not.toContain("error");
  } finally {
    if (timer) clearTimeout(timer);
    // Test-failure cleanup is restricted to the exact child we spawned; no
    // negative PID, process-group signal, PostgreSQL, or other session is used.
    if (child.pid !== undefined && child.exitCode === null && child.signalCode === null) {
      const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
      if (child.kill("SIGKILL")) await exited;
    }
  }
});
