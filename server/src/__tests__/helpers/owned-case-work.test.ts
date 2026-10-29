import { setImmediate } from "node:timers/promises";
import { expect, it } from "vitest";
import { ownedCaseWorkScope } from "./owned-case-work.js";

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(open => { resolve = open; });
  return { promise, resolve };
}

it("releases gates registered by an unfinished body after cleanup begins", async () => {
  const scope = ownedCaseWorkScope();
  const entered = gate();
  let passedLateGate = false;
  const body = scope.run(async () => {
    const first = scope.current().signal();
    entered.resolve();
    await first.promise;
    await scope.current().signal().promise;
    passedLateGate = true;
  });
  await entered.promise;
  await scope.drain();
  await body;
  expect(passedLateGate).toBe(true);
  expect(() => scope.assertIdle()).not.toThrow();
});

it("waits for a child registered while the original body is being drained", async () => {
  const scope = ownedCaseWorkScope();
  const entered = gate(), childEntered = gate(), releaseChild = gate();
  let childFinished = false, drained = false;
  const body = scope.run(async () => {
    const first = scope.current().signal();
    entered.resolve();
    await first.promise;
    scope.current().track((async () => {
      childEntered.resolve();
      await releaseChild.promise;
      childFinished = true;
    })());
  });
  await entered.promise;
  const closing = scope.drain().then(() => { drained = true; });
  try {
    await childEntered.promise;
    await body;
    await setImmediate();
    expect(drained).toBe(false);
    expect(() => scope.assertIdle()).toThrow("has not drained");
  } finally {
    releaseChild.resolve();
    await closing;
  }
  expect(childFinished).toBe(true);
  expect(() => scope.assertIdle()).not.toThrow();
});

it("returns the original body rejection to the caller while cleanup joins it", async () => {
  const scope = ownedCaseWorkScope();
  const failure = Error("owned body failure");
  const body = scope.run(async () => { throw failure; });
  await expect(body).rejects.toBe(failure);
  await scope.drain();
  expect(() => scope.assertIdle()).not.toThrow();
});

it("keeps admission closed after cleanup failure without rerunning finalizers", async () => {
  const scope = ownedCaseWorkScope();
  const failure = Error("owned cleanup failure");
  let closes = 0, successorRan = false;
  await scope.run(async () => {
    scope.current().finally(() => { closes++; throw failure; });
  });
  await expect(scope.drain()).rejects.toBe(failure);
  expect(() => scope.run(async () => { successorRan = true; })).toThrow("has not drained");
  await expect(scope.drain()).rejects.toBe(failure);
  expect(closes).toBe(1);
  expect(successorRan).toBe(false);
});
