import { expect, it, vi } from "vitest";
import { buildRuntimeRoutingCandidate } from "./evidence-service.js";
import { routingEvidenceFixture, evidenceNow } from "./evidence-fixture.js";
function txFixture(replies: unknown[][]) {
  const select = vi.fn((_projection?: unknown) => {
    const response = replies.shift();
    const chain: Record<string, unknown> = { then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve(response)) };
    for (const name of ["from", "where", "for", "limit", "orderBy"]) chain[name] = () => chain;
    return chain;
  });
  return { tx: { select } as never, select };
}
async function call(replies: unknown[][], patch: Record<string, unknown> = {}) {
  const e = await routingEvidenceFixture(), fake = txFixture(replies);
  const result = buildRuntimeRoutingCandidate(fake.tx, e.comparison.actor, { ...e.candidate, ...patch }, {
    datasetId: e.comparison.dataset.id, datasetHash: e.comparison.dataset.datasetHash, maxEvidenceAgeHours: 24, now: evidenceNow });
  return { result, fake, e };
}
it("rejects unavailable/foreign authored metadata before loading private result", async () => {
  const { result, fake } = await call([[]]);
  await expect(result).rejects.toMatchObject({ status: 404, message: "runtime_routing_evidence_not_found" });
  expect(fake.select).toHaveBeenCalledTimes(1);
  expect(Object.keys(fake.select.mock.calls[0][0] as object)).toEqual(["skillVersionId", "bytes"]);
});
it.each(["large_row", "mixed_version"])("bounds %s metadata before loading raw private output", async kind => {
  const e = await routingEvidenceFixture(), version = e.comparison.version.id;
  const rows = [{ skillVersionId: version, bytes: 1 }, { skillVersionId: kind === "mixed_version" ? e.comparison.dataset.id : version, bytes: kind === "large_row" ? 192001 : 1 }];
  const { result, fake } = await call([rows]);
  await expect(result).rejects.toMatchObject({ status: 422, message: "runtime_routing_evidence_limit" });
  expect(fake.select).toHaveBeenCalledTimes(1);
});
it("bounds combined resource sizes before selecting any result or literal content", async () => {
  const e = await routingEvidenceFixture(), rows = e.comparison.tests.map(() => ({ skillVersionId: e.comparison.version.id, bytes: 10 }));
  const { result, fake } = await call([rows, [{ bytes: 1_000_001 }], [{ bytes: 1 }], [{ bytes: 1 }, { bytes: 1 }]]);
  await expect(result).rejects.toMatchObject({ status: 422, message: "runtime_routing_evidence_limit" });
  expect(fake.select).toHaveBeenCalledTimes(4);
  expect(fake.select.mock.calls.every(([projection]) => projection !== undefined)).toBe(true);
});
it("does not accept self-declared prices or owner acknowledgements as evidence input", async () => {
  const { result, fake } = await call([], { observedCostCents: "0.0000000", confirmMissingModel: true });
  await expect(result).rejects.toThrow(); expect(fake.select).not.toHaveBeenCalled();
});
