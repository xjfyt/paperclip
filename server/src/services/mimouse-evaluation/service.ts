import { createHash } from "node:crypto";
import { and, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { activityLog, companies, companySkills, companySkillVersions, companySkillTestInputs, companySkillTestRuns, costEvents,
  mimouseEvaluationDatasets as datasets, mimouseEvaluationComparisons as comparisons, type Db } from "@paperclipai/db";
import { createEvaluationComparisonSchema, createEvaluationDatasetSchema, type CreateEvaluationComparison, type CreateEvaluationDataset } from "@paperclipai/shared/mimouse-evaluation";
import { conflict, notFound, unprocessable } from "../../errors.js";
import { canonical } from "../mimouse-operations/preview.js";
import { compareRecordedSkillRuns, type RecordedSkillRun } from "./compare.js";
import { recordedEvaluationCost } from "./cost.js";
const hash = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
const datasetRecord = (row: typeof datasets.$inferSelect) => ({ id: row.id, companyId: row.companyId, skillId: row.skillId, name: row.name, datasetHash: row.datasetHash, cases: row.cases, createdAt: row.createdAt.toISOString() });
const comparisonRecord = (row: typeof comparisons.$inferSelect) => ({ id: row.id, companyId: row.companyId, datasetId: row.datasetId, report: row.report, createdAt: row.createdAt.toISOString() });
async function activeCompany(tx: Tx, companyId: string) {
  const [company] = await tx.select({ status: companies.status }).from(companies).where(eq(companies.id, companyId));
  if (company?.status !== "active") throw unprocessable("An active company is required");
}
async function audit(tx: Tx, companyId: string, actorId: string, kind: string, id: string, digest: string) {
  await tx.insert(activityLog).values({ companyId, actorType: "user", actorId, action: `evaluation.${kind}.created`, entityType: `evaluation_${kind}`, entityId: id, details: { digest } });
}
export function evaluationService(db: Db) {
  return {
    async listDatasets(companyId: string, beforeId?: string) {
      const rows = await db.select().from(datasets).where(and(eq(datasets.companyId, companyId), beforeId ? lt(datasets.id, beforeId) : undefined)).orderBy(desc(datasets.id)).limit(51);
      return { items: rows.slice(0, 50).map(datasetRecord), nextBeforeId: rows.length > 50 ? rows[49]!.id : null };
    },
    async listComparisons(companyId: string, beforeId?: string) {
      const rows = await db.select().from(comparisons).where(and(eq(comparisons.companyId, companyId), beforeId ? lt(comparisons.id, beforeId) : undefined)).orderBy(desc(comparisons.id)).limit(51);
      return { items: rows.slice(0, 50).map(comparisonRecord), nextBeforeId: rows.length > 50 ? rows[49]!.id : null };
    },
    async getComparison(companyId: string, id: string) {
      const [row] = await db.select().from(comparisons).where(and(eq(comparisons.companyId, companyId), eq(comparisons.id, id)));
      if (!row) throw notFound("Evaluation comparison not found"); return comparisonRecord(row);
    },
    async evidence(companyId: string, skillId: string) {
      const [skill] = await db.select({ id: companySkills.id, name: companySkills.name }).from(companySkills).where(and(eq(companySkills.companyId, companyId), eq(companySkills.id, skillId)));
      if (!skill) throw notFound("Skill not found");
      const versions = await db.select({ id: companySkillVersions.id, revision: companySkillVersions.revisionNumber, label: companySkillVersions.label }).from(companySkillVersions).where(and(eq(companySkillVersions.companyId, companyId), eq(companySkillVersions.companySkillId, skillId))).orderBy(desc(companySkillVersions.revisionNumber)).limit(100);
      const inputs = await db.select({ id: companySkillTestInputs.id, name: companySkillTestInputs.name }).from(companySkillTestInputs).where(and(eq(companySkillTestInputs.companyId, companyId), eq(companySkillTestInputs.skillId, skillId), isNull(companySkillTestInputs.deletedAt))).orderBy(desc(companySkillTestInputs.id)).limit(100);
      const runs = await db.select({ id: companySkillTestRuns.id, inputId: companySkillTestRuns.inputId, versionId: companySkillTestRuns.skillVersionId, status: companySkillTestRuns.status }).from(companySkillTestRuns).where(and(eq(companySkillTestRuns.companyId, companyId), eq(companySkillTestRuns.skillId, skillId), isNull(companySkillTestRuns.deletedAt), isNull(companySkillTestRuns.supersededAt))).orderBy(desc(companySkillTestRuns.createdAt)).limit(200);
      return { skill, versions, inputs, runs, limits: { versions: 100, inputs: 100, runs: 200 } };
    },
    async createDataset(companyId: string, raw: CreateEvaluationDataset, actorId: string) {
      const input = createEvaluationDatasetSchema.parse(raw); input.cases.sort((a, b) => a.inputId.localeCompare(b.inputId)); const requestDigest = hash(input);
      return db.transaction(async tx => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${companyId}:eval-dataset:${input.requestId}`}, 0))`);
        const [existing] = await tx.select().from(datasets).where(and(eq(datasets.companyId, companyId), eq(datasets.requestId, input.requestId)));
        if (existing) { if (existing.requestDigest !== requestDigest) throw conflict("Request ID already used with different input"); return { item: datasetRecord(existing), duplicate: true }; }
        await activeCompany(tx, companyId);
        const rows = await tx.select().from(companySkillTestInputs).where(and(eq(companySkillTestInputs.companyId, companyId), eq(companySkillTestInputs.skillId, input.skillId), isNull(companySkillTestInputs.deletedAt), inArray(companySkillTestInputs.id, input.cases.map(item => item.inputId))));
        if (rows.length !== input.cases.length) throw notFound("Skill test input not found");
        const cases = input.cases.map(item => ({ id: item.inputId, input: rows.find(row => row.id === item.inputId)!.content, expected: item.expected }));
        if (cases.some(item => !item.input || item.input.length > 32000) || Buffer.byteLength(JSON.stringify(cases)) > 1_000_000) throw unprocessable("Dataset input exceeds snapshot limits");
        const datasetHash = hash(cases);
        const [row] = await tx.insert(datasets).values({ companyId, skillId: input.skillId, requestId: input.requestId, requestDigest, name: input.name, cases, datasetHash, actorId }).returning();
        await audit(tx, companyId, actorId, "dataset", row!.id, datasetHash); return { item: datasetRecord(row!), duplicate: false };
      });
    },
    async compare(companyId: string, raw: CreateEvaluationComparison, actorId: string) {
      const input = createEvaluationComparisonSchema.parse(raw); input.runIds.sort(); const requestDigest = hash(input);
      return db.transaction(async tx => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${companyId}:eval-comparison:${input.requestId}`}, 0))`);
        const [existing] = await tx.select().from(comparisons).where(and(eq(comparisons.companyId, companyId), eq(comparisons.requestId, input.requestId)));
        if (existing) { if (existing.requestDigest !== requestDigest) throw conflict("Request ID already used with different input"); return { item: comparisonRecord(existing), duplicate: true }; }
        await activeCompany(tx, companyId);
        const [dataset] = await tx.select().from(datasets).where(and(eq(datasets.companyId, companyId), eq(datasets.id, input.datasetId)));
        if (!dataset) throw notFound("Evaluation dataset not found");
        const versions = await tx.select().from(companySkillVersions).where(and(eq(companySkillVersions.companyId, companyId), eq(companySkillVersions.companySkillId, dataset.skillId), inArray(companySkillVersions.id, [input.baselineVersionId, input.candidateVersionId])));
        if (versions.length !== 2) throw notFound("Two existing skill versions are required");
        const rows = input.runIds.length ? await tx.select().from(companySkillTestRuns).where(and(eq(companySkillTestRuns.companyId, companyId), eq(companySkillTestRuns.skillId, dataset.skillId), isNull(companySkillTestRuns.deletedAt), isNull(companySkillTestRuns.supersededAt), inArray(companySkillTestRuns.id, input.runIds))) : [];
        if (rows.length !== input.runIds.length) throw notFound("Recorded skill run not found");
        if (rows.some(row => row.outputSnapshot.length > 128000) || Buffer.byteLength(JSON.stringify(rows.map(row => [row.inputSnapshot, row.outputSnapshot]))) > 2_000_000) throw unprocessable("Recorded evidence exceeds snapshot limits");
        const ledger = rows.length ? await tx.select({ id: costEvents.id, issueId: costEvents.issueId, costCents: costEvents.costCents, costStatus: costEvents.costStatus, billingType: costEvents.billingType }).from(costEvents).where(and(eq(costEvents.companyId, companyId), inArray(costEvents.issueId, rows.map(row => row.issueId)))).limit(10001) : [];
        if (ledger.length > 10000) throw unprocessable("Cost evidence exceeds snapshot limits");
        const runs: RecordedSkillRun[] = rows.map(row => {
          const costs = ledger.filter(cost => cost.issueId === row.issueId);
          return { id: row.id, companyId: row.companyId, skillId: row.skillId, versionId: row.skillVersionId, caseId: row.inputId ?? "missing_input", inputSnapshot: row.inputSnapshot, outputSnapshot: row.outputSnapshot, status: row.status as RecordedSkillRun["status"], costCents: recordedEvaluationCost(costs), executionContextHash: typeof row.agentConfigSnapshot.adapterType === "string" ? hash({ agent: row.agentConfigSnapshot, template: row.templateBody }) : null };
        });
        let report;
        try { report = await compareRecordedSkillRuns({ companyId, skillId: dataset.skillId, datasetId: dataset.id, baselineVersionId: input.baselineVersionId, candidateVersionId: input.candidateVersionId, cases: dataset.cases, runs, maxCandidateCostCents: input.maxCandidateCostCents }); }
        catch (error) { throw unprocessable(error instanceof Error && /^[a-z_]+$/.test(error.message) ? error.message : "invalid_evaluation_evidence"); }
        if (report.datasetHash !== dataset.datasetHash) throw conflict("Dataset integrity check failed");
        // Retain minimal exact evidence; never persist agent config, credentials or mutable issue documents.
        const evidenceSnapshot = { runs, ledger, versionHashes: versions.map(version => ({ id: version.id, hash: hash(version.fileInventory) })), capturedAt: new Date().toISOString() };
        const [row] = await tx.insert(comparisons).values({ companyId, datasetId: dataset.id, baselineVersionId: input.baselineVersionId, candidateVersionId: input.candidateVersionId, requestId: input.requestId, requestDigest, report, evidenceSnapshot, actorId }).returning();
        await audit(tx, companyId, actorId, "comparison", row!.id, report.reportHash); return { item: comparisonRecord(row!), duplicate: false };
      });
    },
  };
}
