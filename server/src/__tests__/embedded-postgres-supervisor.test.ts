import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { createEmbeddedPostgresSupervisor, type SupervisedEmbeddedPostgres } from "../embedded-postgres-supervisor.js";

function createInstance(startError?: Error) {
  const process = new EventEmitter();
  const instance: SupervisedEmbeddedPostgres = {
    process,
    start: vi.fn(async () => { if (startError) throw startError; }),
    stop: vi.fn(async () => undefined),
  };
  return { instance, process };
}

describe("embedded PostgreSQL supervisor", () => {
  it("restarts PostgreSQL after its managed child exits unexpectedly", async () => {
    const initial = createInstance();
    const replacement = createInstance();
    const onRestarted = vi.fn();
    const supervisor = createEmbeddedPostgresSupervisor({
      initialInstance: initial.instance,
      createInstance: () => replacement.instance,
      restartDelaysMs: [0],
      onRestarted,
    });
    initial.process.emit("exit", 137, "SIGKILL");
    await supervisor.waitForRecovery();
    expect(replacement.instance.start).toHaveBeenCalledOnce();
    expect(supervisor.current()).toBe(replacement.instance);
    expect(onRestarted).toHaveBeenCalledWith(1);
  });

  it("does not restart PostgreSQL during orderly shutdown", async () => {
    const initial = createInstance();
    const createReplacement = vi.fn(() => createInstance().instance);
    const supervisor = createEmbeddedPostgresSupervisor({
      initialInstance: initial.instance,
      createInstance: createReplacement,
      restartDelaysMs: [0],
    });
    await supervisor.shutdown();
    expect(initial.instance.stop).toHaveBeenCalledOnce();
    expect(createReplacement).not.toHaveBeenCalled();
  });

  it("bounds recovery attempts and reports the final failure", async () => {
    const initial = createInstance();
    const failures = [new Error("first"), new Error("second"), new Error("third")];
    const onRecoveryExhausted = vi.fn();
    const supervisor = createEmbeddedPostgresSupervisor({
      initialInstance: initial.instance,
      createInstance: () => createInstance(failures.shift()).instance,
      restartDelaysMs: [0, 0, 0],
      onRecoveryExhausted,
    });
    initial.process.emit("exit", 1, null);
    await supervisor.waitForRecovery();
    expect(onRecoveryExhausted).toHaveBeenCalledOnce();
    expect(onRecoveryExhausted).toHaveBeenCalledWith(expect.objectContaining({ message: "third" }));
  });
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

it("suppresses clean child exit during drain without restarting or stopping an exited child", async () => {
  const initial = createInstance(), createReplacement = vi.fn(() => createInstance().instance), onUnexpectedExit = vi.fn();
  const supervisor = createEmbeddedPostgresSupervisor({ initialInstance: initial.instance, createInstance: createReplacement, onUnexpectedExit });
  supervisor.beginShutdown();
  expect(initial.instance.stop).not.toHaveBeenCalled();
  initial.process.emit("exit", 0, null);
  await supervisor.waitForRecovery();
  expect(createReplacement).not.toHaveBeenCalled(); expect(onUnexpectedExit).not.toHaveBeenCalled();
  await supervisor.shutdown(); expect(initial.instance.stop).not.toHaveBeenCalled();
});

it("delays live child stop until final teardown and shares its completion with all callers", async () => {
  const initial = createInstance(), stopped = deferred();
  vi.mocked(initial.instance.stop).mockImplementation(() => stopped.promise);
  const supervisor = createEmbeddedPostgresSupervisor({ initialInstance: initial.instance, createInstance: () => createInstance().instance });
  supervisor.beginShutdown(); supervisor.beginShutdown();
  await Promise.resolve(); expect(initial.instance.stop).not.toHaveBeenCalled();
  const first = supervisor.shutdown(), second = supervisor.shutdown();
  expect(second).toBe(first);
  let done = false; void second.then(() => { done = true; });
  await Promise.resolve(); expect(done).toBe(false); expect(initial.instance.stop).toHaveBeenCalledOnce();
  stopped.resolve(); await first; expect(done).toBe(true);
  expect(supervisor.shutdown()).toBe(first); expect(initial.instance.stop).toHaveBeenCalledOnce();
});

it("rechecks shutdown after an awaited beforeRestart guard", async () => {
  const initial = createInstance(), guard = deferred(), createReplacement = vi.fn(() => createInstance().instance);
  const supervisor = createEmbeddedPostgresSupervisor({ initialInstance: initial.instance, createInstance: createReplacement, beforeRestart: () => guard.promise });
  initial.process.emit("exit", 1, null);
  supervisor.beginShutdown();
  const stopped = supervisor.shutdown();
  guard.resolve(); await stopped;
  expect(createReplacement).not.toHaveBeenCalled(); expect(initial.instance.stop).not.toHaveBeenCalled();
});

it("cleans up a replacement already starting and awaits its stop before shutdown resolves", async () => {
  const initial = createInstance(), replacement = createInstance(), starting = deferred(), stopping = deferred(), onRestarted = vi.fn();
  vi.mocked(replacement.instance.start).mockImplementation(() => starting.promise);
  vi.mocked(replacement.instance.stop).mockImplementation(() => stopping.promise);
  const supervisor = createEmbeddedPostgresSupervisor({ initialInstance: initial.instance, createInstance: () => replacement.instance, onRestarted });
  initial.process.emit("exit", 1, null);
  await Promise.resolve(); expect(replacement.instance.start).toHaveBeenCalledOnce();
  supervisor.beginShutdown();
  const first = supervisor.shutdown(); expect(supervisor.shutdown()).toBe(first);
  let done = false; void first.then(() => { done = true; });
  starting.resolve(); await Promise.resolve(); await Promise.resolve();
  expect(replacement.instance.stop).toHaveBeenCalledOnce(); expect(done).toBe(false);
  stopping.resolve(); await first;
  expect(onRestarted).not.toHaveBeenCalled(); expect(initial.instance.stop).not.toHaveBeenCalled();
});

it("does not recover after shutdown begins during a retry delay", async () => {
  const initial = createInstance(), waiting = deferred(), createReplacement = vi.fn(() => createInstance().instance);
  const supervisor = createEmbeddedPostgresSupervisor({ initialInstance: initial.instance, createInstance: createReplacement, restartDelaysMs: [1], delay: () => waiting.promise });
  initial.process.emit("exit", 1, null); supervisor.beginShutdown();
  waiting.resolve(); await supervisor.shutdown(); expect(createReplacement).not.toHaveBeenCalled();
});

it("shares a failed final stop without launching another stop or recovery", async () => {
  const initial = createInstance(), failure = new Error("owned stop failed"), createReplacement = vi.fn(() => createInstance().instance);
  vi.mocked(initial.instance.stop).mockRejectedValue(failure);
  const supervisor = createEmbeddedPostgresSupervisor({ initialInstance: initial.instance, createInstance: createReplacement });
  supervisor.beginShutdown();
  const first = supervisor.shutdown(); expect(supervisor.shutdown()).toBe(first);
  await expect(first).rejects.toBe(failure);
  await expect(supervisor.shutdown()).rejects.toBe(failure);
  initial.process.emit("exit", 0, null);
  expect(initial.instance.stop).toHaveBeenCalledOnce(); expect(createReplacement).not.toHaveBeenCalled();
});
