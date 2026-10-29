import { and, desc, eq, getTableColumns, sql } from "drizzle-orm";
import { issues, mimouseCodingDeliveries as deliveries, type Db } from "@paperclipai/db";
import { z } from "zod";
import { normalizeCodingOrigin, type MimouseCodingProjectSummary } from "@paperclipai/shared/mimouse-coding-summary";
import { issuePrivacyCondition, type AuthorizationActor } from "../authorization.js";
import { notFound } from "../../errors.js";
import { buildMatrixInventory } from "./build-matrix.js";
import { reviewedHead } from "./diff-review.js";
import { deliveryGate } from "./gitlab.js";

export const codingListQuerySchema = z.object({
  limit: z.string().regex(/^[1-9][0-9]*$/).transform(Number).pipe(z.number().int().min(1).max(100)).optional().default(100),
  after: z.string().uuid().optional(), issueId: z.string().uuid().optional(),
  gitlabOrigin: z.string().max(2000).refine(value => normalizeCodingOrigin(value) !== null, { message: "Expected an HTTP(S) origin" })
    .transform(value => normalizeCodingOrigin(value)!).optional(),
  projectId: z.string().regex(/^[1-9][0-9]*$/).transform(Number).pipe(z.number().int().positive().max(2_147_483_647)).optional(),
}).strict().refine(input => Boolean(input.gitlabOrigin) === Boolean(input.projectId), { message: "Origin and project ID must be paired" })
  .refine(input => !input.issueId || !input.gitlabOrigin, { message: "Use either task or project filter" });

const sha = z.string().regex(/^[a-f0-9]{40}$/);
const remoteSchema = z.object({
  checkedAt: z.string().datetime({ offset: true }),
  mr: z.object({ iid: z.number().int().positive(), sha, state: z.enum(["opened", "closed", "merged"]) }),
  pipeline: z.object({ id: z.number().int().positive(), sha, status: z.string().min(1).max(40) }),
  lastCode: z.null().optional(),
});
const checksSchema = z.array(z.object({ commitSha: sha, command: z.string().min(1), exitCode: z.number().int().nullable(),
  startedAt: z.string(), finishedAt: z.string(), logRef: z.string().min(1), status: z.enum(["passed", "failed", "blocked", "not_run"]) }));
type Delivery = typeof deliveries.$inferSelect;
export function codingListGate(row: Delivery, now = Date.now()) {
  const remote = remoteSchema.safeParse(row.remoteEvidence); const checks = checksSchema.safeParse(row.evidence);
  const checkedAt = remote.success ? Date.parse(remote.data.checkedAt) : NaN;
  const fresh = remote.success && !row.syncLastCode && Number.isFinite(checkedAt) && checkedAt <= now && now - checkedAt <= 60_000;
  const gate = deliveryGate({ headSha: row.headSha, reviewedSha: reviewedHead(row),
    mr: fresh ? remote.data.mr : null, pipeline: fresh ? remote.data.pipeline : null, evidence: checks.success ? checks.data : [] });
  if (!fresh) gate.blockers.push("remote_evidence_stale_or_unknown");
  return { ...gate, readyForReleaseCandidate: fresh && gate.readyForReleaseCandidate };
}

export async function listCodingDeliveries(db: Db, companyId: string, actor: AuthorizationActor, query: z.infer<typeof codingListQuerySchema>) {
  // Deliberately use the strict direct-read predicate, not issueReadSqlCondition:
  // coding has never bypassed task privacy for local/admin actors or mode=off.
  const where = and(eq(deliveries.companyId, companyId), eq(issues.companyId, companyId), issuePrivacyCondition(actor),
    query.issueId ? eq(deliveries.issueId, query.issueId) : undefined,
    query.gitlabOrigin ? sql`rtrim(${deliveries.gitlabOrigin}, '/') = ${query.gitlabOrigin}` : undefined,
    query.projectId ? eq(deliveries.projectId, query.projectId) : undefined);
  let cursor: { id: string; createdAt: string } | undefined;
  if (query.after) {
    [cursor] = await db.select({ id: deliveries.id, createdAt: sql<string>`${deliveries.createdAt}::text` })
      .from(deliveries).innerJoin(issues, eq(issues.id, deliveries.issueId)).where(and(where, eq(deliveries.id, query.after))).limit(1);
    if (!cursor) throw notFound("Coding cursor not found");
  }
  const rows = await db.select(getTableColumns(deliveries)).from(deliveries).innerJoin(issues, eq(issues.id, deliveries.issueId))
    .where(and(where, cursor ? sql`(${deliveries.createdAt}, ${deliveries.id}) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)` : undefined))
    .orderBy(desc(deliveries.createdAt), desc(deliveries.id)).limit(query.limit + 1);
  const hasMore = rows.length > query.limit; const now = Date.now();
  const visible = rows.slice(0, query.limit).map(row => {
    const { secretRef: _secretRef, operationLease: _operationLease, syncLease: _syncLease, ...publicRow } = row;
    return { ...publicRow, buildMatrix: buildMatrixInventory(row), gate: codingListGate(row, now) };
  });
  const projects = new Map<string, MimouseCodingProjectSummary["projects"][number]>();
  for (const row of visible) {
    const origin = normalizeCodingOrigin(row.gitlabOrigin) ?? row.gitlabOrigin; const key = JSON.stringify([origin, row.projectId]);
    const summary: MimouseCodingProjectSummary["projects"][number] = projects.get(key) ?? { gitlabOrigin: origin, projectId: row.projectId, deliveryCount: 0,
      candidateCount: 0, blockedCount: 0, localArtifactCount: 0, trustedBuildTargetCount: 0, uploadStatus: "blocked", readyForRelease: false };
    summary.deliveryCount++;
    if (row.gate.readyForReleaseCandidate) summary.candidateCount++; else summary.blockedCount++;
    summary.localArtifactCount += row.buildMatrix.targets.reduce((count, target) => count + target.artifacts.length, 0);
    projects.set(key, summary);
  }
  const projectSummary: MimouseCodingProjectSummary = { scope: "authorized_delivery_page", deliveryCount: visible.length, projects: [...projects.values()] };
  return { deliveries: visible, projectSummary, pagination: { limit: query.limit, hasMore, nextCursor: hasMore ? visible.at(-1)!.id : null } };
}
