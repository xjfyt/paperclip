import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { researchRoutineReportSchema, researchRoutineReportContract, type ResearchRoutineProvenance } from "@paperclipai/shared/mimouse-research-routines";
import { researchCandidateSchema } from "@paperclipai/shared";
import { researchDigest } from "../mimouse-research/evidence.js";
import { prepareResearchReport } from "./evidence.js";
function fixture() {
  const input = { routineRunId: randomUUID(), issueId: randomUUID(), title: "Research finding", product: "MiWork", currentState: "Manual", proposedState: "Reviewed", recommendation: "Human review first",
    sources: [{ url: "https://example.invalid/docs?token=fixture-secret", retrievedAt: "2026-10-26T12:00:00+08:00", evidence: "Documented capability", product: "MiWork", gap: "password=fixture-only-secret", suggestion: "Compare documented behavior" }] };
  const provenance: ResearchRoutineProvenance = { companyId: randomUUID(), routineId: randomUUID(), routineRunId: input.routineRunId, issueId: input.issueId,
    runId: randomUUID(), agentId: randomUUID(), bindingUpdatedAt: "2026-10-26T00:00:00.000Z", reportBodyHash: researchDigest(input), sourceVerification: "agent_report", disposition: "quarantined" };
  return { input, provenance };
}
it("retains structured citations and truthful immutable run provenance", () => {
  const { input, provenance } = fixture(), result = prepareResearchReport(input, provenance);
  expect(result.requestId).toBe(provenance.runId);
  expect(result.evidence).toMatchObject({ evidenceMode: "agent_report", provenance, redacted: true });
  expect(result.evidence.sources[0]).toMatchObject({ url: "https://example.invalid/docs", product: "MiWork", retrievedAt: "2026-10-26T04:00:00.000Z", suggestion: "Compare documented behavior" });
  expect(JSON.stringify(result.evidence)).not.toContain("fixture-only-secret");
  expect(JSON.stringify(result.evidence)).not.toContain("fixture-secret");
  expect(result.evidenceHash).toBe(researchDigest(result.evidence));
});
it("stable retries retain identity, changed body or provenance cannot replace a report", () => {
  const { input, provenance } = fixture(), original = prepareResearchReport(input, provenance);
  expect(prepareResearchReport(input, provenance)).toEqual(original);
  expect(prepareResearchReport({ ...input, recommendation: "changed" }, provenance).requestDigest).not.toBe(original.requestDigest);
  expect(prepareResearchReport(input, { ...provenance, routineId: randomUUID() }).requestDigest).not.toBe(original.requestDigest);
  expect(prepareResearchReport(input, { ...provenance, bindingUpdatedAt: "2026-10-27T00:00:00.000Z" }).requestDigest).toBe(original.requestDigest);
});
it("rejects omitted product/gap/suggestion, invented verification and caller run identity", () => {
  const { input } = fixture();
  for (const key of ["product", "gap", "suggestion"] as const) {
    const source = { ...input.sources[0] }; delete (source as Partial<typeof source>)[key];
    expect(researchRoutineReportSchema.safeParse({ ...input, sources: [source] }).success).toBe(false);
  }
  for (const patch of [{ runId: randomUUID() }, { agentId: randomUUID() }, { companyId: randomUUID() }, { requestId: randomUUID() }, { sourceVerification: "independently_verified" }, { provenance: {} }, { sources: [] }]) {
    expect(researchRoutineReportSchema.safeParse({ ...input, ...patch }).success).toBe(false);
  }
});
it("manual schema remains strict and cannot forge agent provenance", () => {
  const { input, provenance } = fixture();
  const { routineRunId: _r, issueId: _i, ...body } = input;
  const manual = { ...body, requestId: randomUUID(), sources: body.sources.map(({ url, retrievedAt, evidence }) => ({ url, retrievedAt, evidence })) };
  expect(researchCandidateSchema.safeParse(manual).success).toBe(true);
  expect(researchCandidateSchema.safeParse({ ...manual, provenance, evidenceMode: "agent_report" }).success).toBe(false);
});
it("contract reuses a routine report endpoint, never a model/dispatch endpoint", () => {
  const contract = researchRoutineReportContract("company", "routine", "MiWork");
  expect(contract.path).toBe("/api/companies/company/research-routines/routine/reports");
  expect(contract.sourceFields).toEqual(["url", "retrievedAt", "product", "evidence", "gap", "suggestion"]);
});
