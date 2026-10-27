import { expect, it } from "vitest";
import type { MimouseBuildObservationRequestOutcome, StartMimouseBuildObservationInput } from "@paperclipai/shared";
import { clearBuildObservationJournal, ensureBuildObservationJournal, readBuildObservationJournal } from "./build-observation-journal";

class MemoryStorage {
  values = new Map<string, string>(); get length() { return this.values.size; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}
const scope = { companyId: "company", userId: "owner", deliveryId: "delivery" };
const input: StartMimouseBuildObservationInput = { requestId: "7537f5ba-ae42-4a48-89a1-79949638fd83", profileId: "fixture", jobId: 42, expectedBinding: "a".repeat(64) };
function terminal(): MimouseBuildObservationRequestOutcome {
  return { requestId: input.requestId, input, state: "terminal", attemptCount: 1, createdAt: "2026-10-27T10:00:00Z", retryUntil: "2026-10-27T10:05:00Z",
    receipt: { id: "durable", requestId: input.requestId, deliveryId: scope.deliveryId, profileId: input.profileId, status: "blocked", diagnostic: "observation_closed_unconfirmed",
      admission: "blocked", observedAt: null, createdAt: "2026-10-27T10:00:00Z", currentness: { status: "unknown", reasons: ["historical_observation"] },
      result: { status: "blocked", diagnostic: "observation_closed_unconfirmed", admission: "blocked", jobRechecked: false, pipelineRechecked: false,
        provenance: { status: "not_checked", reason: "not_collected" }, blockers: [], otherFacts: { workflowClosure: "unassessed", platform: "unassessed", tests: "unassessed",
          artifactCodeSignature: "unassessed", controllerObservation: "blocked", c3: "blocked" } } } };
}
it("persists only canonical safe input under an isolated per-request stable scope", () => {
  const storage = new MemoryStorage(); ensureBuildObservationJournal(scope, input, storage);
  expect([...storage.values.values()]).toEqual([JSON.stringify(input)]); expect(readBuildObservationJournal(scope, storage)).toEqual([input]);
  expect(readBuildObservationJournal({ ...scope, userId: "other" }, storage)).toEqual([]);
  expect(readBuildObservationJournal({ ...scope, companyId: "other" }, storage)).toEqual([]);
  expect(readBuildObservationJournal({ ...scope, deliveryId: "other" }, storage)).toEqual([]);
});
it("never overwrites a different pending ID and accepts repeated validation of the same body", () => {
  const storage = new MemoryStorage(); ensureBuildObservationJournal(scope, input, storage); const before = [...storage.values];
  ensureBuildObservationJournal(scope, input, storage);
  expect(() => ensureBuildObservationJournal(scope, { ...input, requestId: "8537f5ba-ae42-4a48-89a1-79949638fd83" }, storage)).toThrow("observation_journal_unavailable");
  expect(() => ensureBuildObservationJournal(scope, { ...input, jobId: 43 }, storage)).toThrow("observation_journal_unavailable");
  expect([...storage.values]).toEqual(before);
});
it("fails closed on read, write, readback and removal failures", () => {
  const unreadable = new MemoryStorage(); unreadable.key = () => { throw Error("private"); }; unreadable.values.set("a", "b");
  expect(() => readBuildObservationJournal(scope, unreadable)).toThrow("observation_journal_unavailable");
  const unwritable = new MemoryStorage(); unwritable.setItem = () => { throw Error("quota"); };
  expect(() => ensureBuildObservationJournal(scope, input, unwritable)).toThrow("observation_journal_unavailable");
  const lostWrite = new MemoryStorage(); lostWrite.setItem = () => undefined;
  expect(() => ensureBuildObservationJournal(scope, input, lostWrite)).toThrow("observation_journal_unavailable");
  const stuck = new MemoryStorage(); ensureBuildObservationJournal(scope, input, stuck); stuck.removeItem = () => undefined;
  expect(() => clearBuildObservationJournal(scope, input, terminal(), stuck)).toThrow("observation_journal_unavailable");
  expect(readBuildObservationJournal(scope, stuck)).toEqual([input]);
});
it("clears only a matching durable terminal receipt, never interrupted or another ID", () => {
  const storage = new MemoryStorage(); ensureBuildObservationJournal(scope, input, storage);
  for (const value of [{ ...terminal(), state: "interrupted" as const }, { ...terminal(), receipt: null },
    { ...terminal(), requestId: "other" }, { ...terminal(), input: { ...input, jobId: 43 } }])
    expect(() => clearBuildObservationJournal(scope, input, value, storage)).toThrow("observation_journal_unavailable");
  expect(readBuildObservationJournal(scope, storage)).toEqual([input]); clearBuildObservationJournal(scope, input, terminal(), storage);
  expect(readBuildObservationJournal(scope, storage)).toEqual([]);
});
it("bounds pending entries and rejects ambiguous, altered or oversized stored JSON", () => {
  const storage = new MemoryStorage(); ensureBuildObservationJournal(scope, input, storage); const key = storage.key(0)!;
  for (const raw of [JSON.stringify({ ...input, token: "forbidden" }), JSON.stringify(input).replace('"jobId":42', '"jobId":42,"jobId":42'), " ".repeat(1025)]) {
    storage.values.set(key, raw); expect(() => readBuildObservationJournal(scope, storage)).toThrow("observation_journal_unavailable");
  }
  storage.values.clear();
  for (let index = 0; index < 17; index++) {
    const value = { ...input, requestId: `${String(index).padStart(8, "0")}-ae42-4a48-89a1-79949638fd83` };
    storage.values.set(key.replace(input.requestId, value.requestId), JSON.stringify(value));
  }
  expect(() => readBuildObservationJournal(scope, storage)).toThrow("observation_journal_unavailable");
});
