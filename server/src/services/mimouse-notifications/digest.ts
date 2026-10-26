import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { notificationMergeKey, supportsNotificationDigest, type evaluateNotificationPolicy } from "./policy.js";
import { renderNotificationDigest } from "./render.js";

export const NOTIFICATION_DIGEST_LIMIT = 10;
export function notificationDigestEnabled(event: string, kind: string, decision: ReturnType<typeof evaluateNotificationPolicy>) {
  return !decision.filtered && decision.mergeWindowSeconds > 0 && decision.policy.mergeMode === "digest" && supportsNotificationDigest(event, kind);
}
type Snapshot = Record<string, unknown>;
type Transaction = Pick<Parameters<Parameters<Db["transaction"]>[0]>[0], "execute">;
interface Member { id: string; snapshot: Snapshot }
interface Digest { version: 1; title: string; text: string; members: string[] }
export interface DigestClaim extends Member { company_id: string; subscription_id: string; endpoint_id: string; lease: string; merge_key?: string | null }

/** Ignore only event content/identity. Every frozen transport field remains in the key. */
export function notificationDigestKey(company: string, subscription: string, snapshot: Snapshot) {
  const { text: _text, policyResourceId: _resource, digestEnvelope: _envelope, ...boundary } = snapshot;
  return notificationMergeKey(company, subscription, String(snapshot.policyEvent), "digest-v1", boundary);
}

/** Called in the business transaction. Row locking fences admission against worker claim. */
export async function notificationDigestWindow(tx: Transaction, company: string, key: string, seconds: number) {
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 300) throw Error("invalid_notification_merge_window");
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`notification-digest:${company}:${key}`},0))`);
  const rows = await tx.execute(sql`SELECT d.id, d.merge_until FROM mimouse_notification_deliveries d
    WHERE d.company_id=${company} AND d.merge_key=${key} AND d.merged_into IS NULL
      AND d.state='pending' AND d.attempt=0 AND d.merge_until>clock_timestamp()
      AND d.snapshot->'digestEnvelope' IS NULL
      AND (SELECT count(*) FROM (SELECT 1 FROM mimouse_notification_deliveries child
        WHERE child.company_id=${company} AND child.merge_key=${key} AND child.merged_into=d.id
        LIMIT ${NOTIFICATION_DIGEST_LIMIT - 1}) members)<${NOTIFICATION_DIGEST_LIMIT - 1}
    ORDER BY d.created_at, d.id LIMIT 1 FOR UPDATE OF d`);
  const leader = (rows as unknown as { id: string; merge_until: Date | string }[])[0];
  if (leader) return { mergeKey: key, mergeUntil: new Date(leader.merge_until), mergedInto: leader.id, state: "merged", lastCode: "merged_digest" };
  const clock = await tx.execute(sql`SELECT clock_timestamp()+${seconds}*interval '1 second' AS until`);
  const until = new Date((clock as unknown as { until: Date | string }[])[0].until);
  return { mergeKey: key, mergeUntil: until, nextAttemptAt: until };
}

export function buildNotificationDigest(row: DigestClaim, children: Member[]): Digest {
  const members = [{ id: row.id, snapshot: row.snapshot }, ...children];
  if (members.length > NOTIFICATION_DIGEST_LIMIT || new Set(members.map(member => member.id)).size !== members.length) throw Error("invalid_digest_members");
  const key = notificationDigestKey(row.company_id, row.subscription_id, row.snapshot);
  if (row.merge_key !== key || row.snapshot.digestVersion !== 1 || row.snapshot.renderVersion !== 2
    || !supportsNotificationDigest(String(row.snapshot.policyEvent), String(row.snapshot.kind))) throw Error("invalid_digest_boundary");
  for (const member of members) {
    if (notificationDigestKey(row.company_id, row.subscription_id, member.snapshot) !== key) throw Error("invalid_digest_boundary");
  }
  const content = renderNotificationDigest(String(row.snapshot.title), members.map(member => String(member.snapshot.policyResourceId)), String(row.snapshot.locale));
  // Leave room for the channel wrapper and immutable detail URL (not arbitrary task URLs).
  if (Buffer.byteLength(JSON.stringify(content), "utf8") > 3000) throw Error("digest_too_large");
  return { version: 1, ...content, members: members.map(member => member.id) };
}

/** One durable envelope before token/network work; source title/text remain untouched. */
export async function freezeNotificationDigest(db: Pick<Db, "transaction">, row: DigestClaim): Promise<Snapshot | null> {
  return db.transaction(async tx => {
    const live = await tx.execute(sql`SELECT snapshot FROM mimouse_notification_deliveries
      WHERE company_id=${row.company_id} AND id=${row.id} AND lease=${row.lease}
        AND state='claimed' AND lease_expires_at>now() FOR UPDATE`);
    if (!live.length) return null;
    const snapshot = (live[0] as unknown as { snapshot: Snapshot }).snapshot;
    if (snapshot.digestEnvelope !== undefined) { notificationDispatchContent(snapshot); return snapshot; }
    const children = await tx.execute(sql`SELECT id, snapshot FROM mimouse_notification_deliveries
      WHERE company_id=${row.company_id} AND subscription_id=${row.subscription_id} AND endpoint_id=${row.endpoint_id}
        AND merged_into=${row.id} AND state='merged' ORDER BY created_at, id LIMIT ${NOTIFICATION_DIGEST_LIMIT}`);
    const envelope = buildNotificationDigest({ ...row, snapshot }, children as unknown as Member[]);
    const frozen = { ...snapshot, digestEnvelope: envelope };
    await tx.execute(sql`UPDATE mimouse_notification_deliveries SET snapshot=${JSON.stringify(frozen)}::jsonb,updated_at=now()
      WHERE company_id=${row.company_id} AND id=${row.id} AND lease=${row.lease} AND state='claimed'`);
    return frozen;
  });
}

/** Automatic/manual retries dispatch the same persisted envelope, never re-collect children. */
export function notificationDispatchContent(snapshot: Snapshot): { title: string; text: string } {
  if (snapshot.digestVersion !== 1) return { title: String(snapshot.title ?? ""), text: String(snapshot.text ?? "") };
  const digest = snapshot.digestEnvelope as Digest | undefined;
  if (!digest || digest.version !== 1 || typeof digest.title !== "string" || typeof digest.text !== "string"
    || !Array.isArray(digest.members) || digest.members.length < 1 || digest.members.length > NOTIFICATION_DIGEST_LIMIT
    || digest.members.some(id => typeof id !== "string") || Buffer.byteLength(JSON.stringify({ title: digest.title, text: digest.text }), "utf8") > 3000) throw Error("invalid_digest_envelope");
  return { title: digest.title, text: digest.text };
}
