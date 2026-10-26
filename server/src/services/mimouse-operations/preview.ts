import { createHash } from "node:crypto";
import { isSafeOperationField, type OperationPreviewInput as PreviewInput, type OperationScalar as Scalar, type OperationPreview } from "@paperclipai/shared";
type TargetRecord = PreviewInput["targetRecords"][number];
function fail(code: string): never { throw new Error(code); }
function text(value: unknown, max: number, code: string): asserts value is string { if (typeof value !== "string" || !value || value.length > max || value.trim() !== value || /[\u0000-\u001f]/u.test(value)) fail(code); }
function plain(value: unknown): asserts value is Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail("plain_object_required"); }
function keys(value: Record<string, unknown>, allowed: string[]) { if (Object.keys(value).some(key => !allowed.includes(key))) fail("unexpected_field"); }
function field(value: unknown): asserts value is string { text(value, 80, "invalid_field_name"); if (!isSafeOperationField(value)) fail("sensitive_or_unsafe_field"); }
function values(record: unknown): asserts record is Record<string, Scalar> {
  plain(record); if (Object.keys(record).length > 50) fail("too_many_fields");
  for (const [key, value] of Object.entries(record)) { field(key); if (value !== null && typeof value !== "boolean" && !(typeof value === "string" && value.length <= 4000) && !(typeof value === "number" && Number.isSafeInteger(value))) fail("invalid_scalar_use_decimal_string"); }
}
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
}
const hash = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function timestamp(value: unknown): Date {
  if (typeof value !== "string") fail("invalid_timestamp");
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) fail("timestamp_requires_offset");
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  if (year < 1970 || month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate() || hour > 23 || minute > 59 || second > 59) fail("invalid_timestamp");
  const result = new Date(value); if (!Number.isFinite(result.getTime())) fail("invalid_timestamp"); return result;
}
/** Pure preview: no connector, write, money arithmetic or model execution. */
export function operationPreview(raw: PreviewInput): OperationPreview {
  plain(raw); keys(raw, ["companyId", "period", "timeZone", "sourceInstance", "targetInstance", "mapping", "sourceRecords", "targetRecords"]);
  for (const name of ["companyId", "sourceInstance", "targetInstance"] as const) text(raw[name], 160, "invalid_identity");
  if (typeof raw.period !== "string" || !/^(?:19[7-9]\d|[2-9]\d{3})-(?:0[1-9]|1[0-2])$/.test(raw.period)) fail("invalid_month");
  text(raw.timeZone, 100, "timezone_required");
  let dateFormat: Intl.DateTimeFormat;
  try { dateFormat = new Intl.DateTimeFormat("en-US-u-ca-gregory-nu-latn", { timeZone: raw.timeZone, year: "numeric", month: "2-digit" }); } catch { fail("invalid_timezone"); }
  const timeZone = dateFormat.resolvedOptions().timeZone;
  if (!Array.isArray(raw.mapping) || !raw.mapping.length || raw.mapping.length > 50) fail("invalid_mapping");
  const mappedFields = new Set<string>();
  for (const entry of raw.mapping) { plain(entry); keys(entry, ["sourceField", "targetField"]); field(entry.sourceField); field(entry.targetField); if (mappedFields.has(entry.targetField)) fail("duplicate_target_field"); mappedFields.add(entry.targetField); }
  if (!Array.isArray(raw.sourceRecords) || !raw.sourceRecords.length || raw.sourceRecords.length > 1000 || !Array.isArray(raw.targetRecords) || raw.targetRecords.length > 1000) fail("invalid_batch_size");
  const targets = new Map<string, TargetRecord>();
  for (const target of raw.targetRecords) { plain(target); keys(target, ["targetId", "version", "values"]); text(target.targetId, 160, "invalid_target_id"); values(target.values); if (target.version !== null) text(target.version, 240, "invalid_target_version"); if (targets.has(target.targetId)) fail("duplicate_target_record"); targets.set(target.targetId, target); }
  const sourceIds = new Set<string>(), targetIds = new Set<string>();
  const excluded: Array<{ sourceId: string; reason: "outside_period"; occurredAt: string; observedPeriod: string }> = [];
  const operations: Array<{ key: string; sourceId: string; targetId: string; action: "insert" | "update" | "noop"; before: Record<string, Scalar> | null; after: Record<string, Scalar>; expectedTargetHash: string | null; expectedTargetVersion: string | null; sourceHash: string; afterHash: string }> = [];
  for (const source of raw.sourceRecords) {
    plain(source); keys(source, ["sourceId", "targetId", "occurredAt", "values"]); text(source.sourceId, 160, "invalid_source_id"); text(source.targetId, 160, "invalid_target_id"); values(source.values);
    if (sourceIds.has(source.sourceId)) fail("duplicate_source_record"); sourceIds.add(source.sourceId);
    const date = timestamp(source.occurredAt), parts = dateFormat.formatToParts(date), month = `${parts.find(p => p.type === "year")!.value}-${parts.find(p => p.type === "month")!.value}`;
    if (month !== raw.period) { excluded.push({ sourceId: source.sourceId, reason: "outside_period", occurredAt: source.occurredAt, observedPeriod: month }); continue; }
    if (targetIds.has(source.targetId)) fail("multiple_sources_one_target"); targetIds.add(source.targetId);
    const target = targets.get(source.targetId), after: Record<string, Scalar> = { ...target?.values };
    for (const entry of raw.mapping) { if (!Object.hasOwn(source.values, entry.sourceField)) fail("missing_source_field"); after[entry.targetField] = source.values[entry.sourceField]; }
    const action = !target ? "insert" : canonical(target.values) === canonical(after) ? "noop" : "update";
    const key = hash([raw.companyId, raw.period, raw.sourceInstance, source.sourceId, raw.targetInstance, source.targetId, "upsert"]);
    operations.push({ key, sourceId: source.sourceId, targetId: source.targetId, action, before: target ? { ...target.values } : null, after,
      expectedTargetHash: target ? hash({ targetId: target.targetId, version: target.version, values: target.values }) : null,
      expectedTargetVersion: target?.version ?? null, sourceHash: hash(source), afterHash: hash(after) });
  }
  operations.sort((a, b) => compare(a.sourceId, b.sourceId)); excluded.sort((a, b) => compare(a.sourceId, b.sourceId));
  const preview = { schemaVersion: 1 as const, companyId: raw.companyId, period: raw.period, timeZone, sourceInstance: raw.sourceInstance, targetInstance: raw.targetInstance,
    mapping: [...raw.mapping].sort((a, b) => compare(a.targetField, b.targetField)), operations, excluded, evidenceMode: "imported_snapshot" as const, mode: "dry_run" as const,
    counts: { insert: operations.filter(item => item.action === "insert").length, update: operations.filter(item => item.action === "update").length, noop: operations.filter(item => item.action === "noop").length, excluded: excluded.length },
    externalWrites: 0 as const };
  return { ...preview, previewHash: hash(preview) };
}
