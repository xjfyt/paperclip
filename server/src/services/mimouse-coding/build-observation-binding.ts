import { createHash } from "node:crypto";
import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { authSessions, authUsers, companies, companyMemberships, companySecrets, companySecretVersions, issues,
  issueAccessGrants, projects, projectAccessMembers, mimouseCodingDeliveries as deliveries, type Db } from "@paperclipai/db";
import { conflict, forbidden, notFound, unprocessable } from "../../errors.js";
import { canActorReadIssuePrivacy } from "../authorization.js";
import type { BuildObservationProfile } from "./build-observation-config.js";

export type ObservationTx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type ObservationIdentity = { companyId: string; userId: string; sessionId: string };
export function observationDigest(value: unknown): string {
  function canonical(item: unknown): string {
    if (item === null || typeof item === "string" || typeof item === "number" || typeof item === "boolean") return JSON.stringify(item);
    if (Array.isArray(item)) return `[${item.map(canonical).join(",")}]`;
    if (typeof item === "object") return `{${Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, val]) => `${JSON.stringify(key)}:${canonical(val)}`).join(",")}}`;
    throw unprocessable("observation_binding_invalid");
  }
  return createHash("sha256").update(canonical(value)).digest("hex");
}
export async function observationTransaction<T>(db: Db, work: (tx: ObservationTx) => Promise<T>): Promise<T> {
  return db.transaction(async tx => {
    await tx.execute(sql`select set_config('lock_timeout', '1000', true), set_config('statement_timeout', '2000', true),
      set_config('idle_in_transaction_session_timeout', '5000', true)`);
    return work(tx);
  });
}
/** Current persisted session and membership, never request-cached roles. */
export async function authorizeObservation(tx: ObservationTx, actor: ObservationIdentity, deliveryId: string, options: { allowPausedCompany?: boolean } = {}) {
  const [session] = await tx.select({ id: authSessions.id }).from(authSessions).innerJoin(authUsers, eq(authUsers.id, authSessions.userId))
    .where(and(eq(authSessions.id, actor.sessionId), eq(authSessions.userId, actor.userId), gt(authSessions.expiresAt, sql`clock_timestamp()`))).for("share");
  const [company] = await tx.select({ status: companies.status }).from(companies).where(eq(companies.id, actor.companyId)).for("share");
  const [member] = await tx.select({ role: companyMemberships.membershipRole }).from(companyMemberships).where(and(
    eq(companyMemberships.companyId, actor.companyId), eq(companyMemberships.principalType, "user"), eq(companyMemberships.principalId, actor.userId),
    eq(companyMemberships.status, "active"), inArray(companyMemberships.membershipRole, ["owner", "admin"]))).for("share");
  if (!session || !member || !company || company.status !== "active" && !(options.allowPausedCompany === true && company.status === "paused")) throw forbidden("observation_access_denied");
  const [delivery] = await tx.select().from(deliveries).where(and(eq(deliveries.companyId, actor.companyId), eq(deliveries.id, deliveryId))).for("share");
  if (!delivery) throw notFound("observation_delivery_not_found");
  // Lock the bounded privacy ancestry, including grants used by the shared
  // predicate. Revocation cannot race the final receipt/response transaction.
  const ancestry = await tx.select().from(issues).where(and(eq(issues.companyId, actor.companyId), sql`${issues.id} in (
    with recursive parents as (
      select id, privacy_parent_issue_id from issues where company_id = ${actor.companyId} and id = ${delivery.issueId}
      union select p.id, p.privacy_parent_issue_id from issues p join parents c on p.id = c.privacy_parent_issue_id where p.company_id = ${actor.companyId}
    ) select id from parents limit 65
  )`)).orderBy(issues.id).for("share");
  const issue = ancestry.find(row => row.id === delivery.issueId);
  if (!issue || ancestry.length > 64) throw forbidden("observation_access_denied");
  const issueIds = ancestry.map(row => row.id); const projectIds = ancestry.flatMap(row => row.projectId ? [row.projectId] : []);
  if (projectIds.length) {
    await tx.select({ id: projects.id }).from(projects).where(and(eq(projects.companyId, actor.companyId), inArray(projects.id, projectIds))).orderBy(projects.id).for("share");
    await tx.select({ id: projectAccessMembers.id }).from(projectAccessMembers).where(and(eq(projectAccessMembers.companyId, actor.companyId),
      inArray(projectAccessMembers.projectId, projectIds), eq(projectAccessMembers.subjectType, "user"), eq(projectAccessMembers.subjectId, actor.userId)))
      .orderBy(projectAccessMembers.id).for("share");
  }
  await tx.select({ id: issueAccessGrants.id }).from(issueAccessGrants).where(and(inArray(issueAccessGrants.issueId, issueIds),
    eq(issueAccessGrants.subjectType, "user"), eq(issueAccessGrants.subjectId, actor.userId), isNull(issueAccessGrants.revokedAt))).orderBy(issueAccessGrants.id).for("share");
  if (!await canActorReadIssuePrivacy(tx, { type: "board", source: "session", userId: actor.userId }, issue)) throw forbidden("observation_access_denied");
  return delivery;
}
const path = z.string().min(1).max(1000).regex(/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/)
  .refine(value => value.split("/").every(part => part !== "." && part !== ".."));
const manifestSchema = z.object({ schemaVersion: z.literal(1), project: z.string().max(100), version: z.string().min(1).max(100),
  commitSha: z.string().regex(/^[a-f0-9]{40}$/), uploaded: z.literal(false), productionReleased: z.literal(false),
  artifacts: z.array(z.object({ path, location: path, fileName: z.string().min(1).max(1000), platform: z.enum(["windows", "macos", "linux"]),
    arch: z.enum(["x86_64", "arm64"]), buildJob: z.string().min(1).max(200), testStatus: z.enum(["passed", "failed", "not_run"]),
    signatureStatus: z.enum(["verified", "unsigned", "unknown"]), sizeBytes: z.number().int().min(0).max(64 * 1024 * 1024),
    sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).min(1).max(30),
}).strict();
export async function bindObservation(tx: ObservationTx, actor: ObservationIdentity, delivery: typeof deliveries.$inferSelect,
  profile: BuildObservationProfile, configDigest: string) {
  const manifest = manifestSchema.safeParse(delivery.artifactManifest);
  if (profile.companyId !== actor.companyId || profile.observer.companyId !== actor.companyId || profile.observer.origin !== delivery.gitlabOrigin
    || profile.observer.projectId !== delivery.projectId || !delivery.pipelineId || !manifest.success
    || manifest.data.commitSha !== delivery.headSha || manifest.data.project !== String(delivery.projectId)) throw conflict("observation_identity_unavailable");
  const artifacts = manifest.data.artifacts.filter(item => item.path === profile.manifestPath && item.location === profile.manifestPath);
  if (artifacts.length !== 1) throw conflict("observation_manifest_ambiguous");
  const [credential] = await tx.select({ secretId: companySecrets.id, version: companySecretVersions.version, valueSha256: companySecretVersions.valueSha256 })
    .from(companySecrets).innerJoin(companySecretVersions, and(eq(companySecretVersions.secretId, companySecrets.id), eq(companySecretVersions.version, companySecrets.latestVersion)))
    .where(and(eq(companySecrets.id, delivery.secretRef), eq(companySecrets.companyId, actor.companyId), eq(companySecrets.scope, "company"),
      eq(companySecrets.status, "active"), eq(companySecrets.provider, "local_encrypted"), isNull(companySecrets.deletedAt),
      inArray(companySecretVersions.status, ["current", "active"]), isNull(companySecretVersions.revokedAt))).for("share");
  if (!credential || !/^[a-f0-9]{64}$/.test(credential.valueSha256)) throw conflict("observation_credential_unavailable");
  const artifact = artifacts[0];
  const snapshotDigest = observationDigest({ companyId: actor.companyId, deliveryId: delivery.id, issueId: delivery.issueId,
    workspaceId: delivery.workspaceId, origin: delivery.gitlabOrigin, projectId: delivery.projectId, pipelineId: delivery.pipelineId,
    headSha: delivery.headSha, sourceBranch: delivery.sourceBranch, manifest: manifest.data, credential, configDigest, profileId: profile.id });
  return { snapshotDigest, credential, artifact, pipelineId: delivery.pipelineId, headSha: delivery.headSha, profile };
}
