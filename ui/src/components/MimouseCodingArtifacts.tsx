import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/api/client";
import { useTranslation } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Artifact = { path: string; platform: "windows" | "macos" | "linux"; arch: "x86_64" | "arm64"; buildJob: string };
type Draft = { headSha: string; version: string; artifacts: Artifact[] };
type Props = { companyId: string; userId: string; sessionId: string; deliveryId: string; projectId: number; headSha: string; onRefresh: () => Promise<unknown> };
const freshArtifact = (): Artifact => ({ path: "", platform: "linux", arch: "x86_64", buildJob: "" });
const validPath = (value: string) => value.length > 0 && value.length <= 1000 && !/^(?:[\\/]|[A-Za-z]:)/.test(value)
  && !value.includes("\0") && !value.split(/[\\/]/).some(segment => segment === ".." || segment === ".");
const validDraft = (draft: Draft) => /^[a-f0-9]{40}$/.test(draft.headSha) && draft.version.trim().length > 0 && draft.version.length <= 100
  && draft.artifacts.length >= 1 && draft.artifacts.length <= 30 && draft.artifacts.every(row => validPath(row.path)
    && row.buildJob.trim().length > 0 && row.buildJob.length <= 200);

/** A matching response confirms only recorded local bytes, not a build or upload. */
function matchesReceipt(value: unknown, draft: Draft, projectId: number) {
  const receipt = value as Record<string, unknown> | null;
  return receipt?.schemaVersion === 1 && receipt.project === String(projectId) && receipt.commitSha === draft.headSha
    && receipt.version === draft.version && receipt.uploaded === false && receipt.productionReleased === false
    && Array.isArray(receipt.artifacts) && receipt.artifacts.length === draft.artifacts.length
    && receipt.artifacts.every((item: Record<string, unknown>, index: number) => {
      const expected = draft.artifacts[index];
      return item && item.path === expected.path && item.platform === expected.platform && item.arch === expected.arch
        && item.buildJob === expected.buildJob && item.testStatus === "not_run" && item.signatureStatus === "unknown"
        && typeof item.sha256 === "string" && /^[a-f0-9]{64}$/.test(item.sha256)
        && typeof item.sizeBytes === "number" && Number.isSafeInteger(item.sizeBytes) && item.sizeBytes >= 0;
    });
}

export function MimouseCodingArtifacts(props: Props) {
  // Same-user session replacement must discard confirmation and late responses too.
  const identity = JSON.stringify([props.companyId, props.userId, props.sessionId, props.deliveryId, props.headSha]);
  return <ArtifactForm key={identity} {...props} identity={identity} />;
}

function ArtifactForm({ companyId, deliveryId, projectId, headSha, onRefresh, identity }: Props & { identity: string }) {
  const { t } = useTranslation();
  const storageKey = `paperclip:artifact-unconfirmed:${identity}`;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>({ headSha, version: "", artifacts: [freshArtifact()] });
  const [review, setReview] = useState(false), [confirmed, setConfirmed] = useState(false);
  const [state, setState] = useState<"idle" | "pending" | "saved" | "unknown" | "rejected" | "denied" | "storage">(() => {
    try { return sessionStorage.getItem(storageKey) ? "unknown" : "idle"; } catch { return "storage"; }
  });
  const [refreshing, setRefreshing] = useState(false), [refreshFailed, setRefreshFailed] = useState(false);
  const [inspected, setInspected] = useState(false), [reconciled, setReconciled] = useState(false);
  const active = useRef(true), inFlight = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const pending = state === "pending";
  const blocked = pending || state === "unknown" || state === "denied" || state === "storage";
  const editable = !blocked && !review;
  const update = (next: Draft) => { setDraft(next); setConfirmed(false); setState("idle"); };
  async function refresh() {
    if (refreshing) return;
    setRefreshing(true); setRefreshFailed(false); setInspected(false); setReconciled(false);
    try { await onRefresh(); if (active.current) setInspected(true); }
    catch { if (active.current) setRefreshFailed(true); }
    finally { if (active.current) setRefreshing(false); }
  }
  async function save() {
    if (!review || !confirmed || blocked || inFlight.current || !validDraft(draft) || !Number.isSafeInteger(projectId)) return;
    // The API has no idempotency key. Persist only an uncertainty marker, never
    // paths/content. A reload cannot silently turn a lost response into a retry.
    try { sessionStorage.setItem(storageKey, "unconfirmed"); }
    catch { setState("storage"); setConfirmed(false); return; }
    inFlight.current = true; setState("pending"); setConfirmed(false);
    let recorded = false;
    try {
      const result = await api.post<unknown>(`/companies/${companyId}/coding/${deliveryId}/artifacts`, draft);
      if (!matchesReceipt(result, draft, projectId)) throw Error("unconfirmed_manifest_response");
      sessionStorage.removeItem(storageKey); recorded = true;
      if (!active.current) return;
      setState("saved"); setReview(false);
      setDraft({ headSha, version: "", artifacts: [freshArtifact()] });
      await refresh();
    } catch (error) {
      if (recorded || !active.current) return;
      const rejected = error instanceof ApiError && [400, 401, 403, 404, 409, 422].includes(error.status);
      if (rejected) {
        try { sessionStorage.removeItem(storageKey); }
        catch { setState("storage"); return; }
        setState([401, 403, 404].includes(error.status) ? "denied" : "rejected");
        setReview(false);
        if ([401, 403, 404].includes(error.status)) setDraft({ headSha, version: "", artifacts: [freshArtifact()] });
      } else { setState("unknown"); setInspected(false); setReconciled(false); }
    } finally { inFlight.current = false; }
  }
  function newAfterReconciliation() {
    if (state !== "unknown" || !inspected || !reconciled || refreshing) return;
    try { sessionStorage.removeItem(storageKey); }
    catch { setState("storage"); return; }
    setState("idle"); setReview(false); setConfirmed(false); setInspected(false); setReconciled(false);
    setDraft({ headSha, version: "", artifacts: [freshArtifact()] });
  }
  return <div className="space-y-3">
    <Button variant="outline" disabled={pending} onClick={() => { setOpen(value => !value); setReview(false); setConfirmed(false); }}>{t("codingArtifacts.title")}</Button>
    {open && <section className="space-y-3 rounded-lg border border-border p-4" aria-label={t("codingArtifacts.title")}>
      <h3 className="font-medium">{t("codingArtifacts.title")}</h3>
      <p className="text-sm text-muted-foreground">{t("codingArtifacts.boundary")}</p>
      <p className="break-all font-mono text-sm">{headSha}</p>
      <p className="text-sm">{t("codingArtifacts.effects")}</p>
      {state !== "idle" && <p role={state === "pending" || state === "saved" ? "status" : "alert"}>{t(`codingArtifacts.${state}`)}</p>}
      {refreshing && <p role="status">{t("common.loading")}</p>}
      {refreshFailed && <p role="alert">{t("codingArtifacts.refreshFailed")}</p>}
      {state !== "denied" && state !== "storage" && <>
        <fieldset disabled={!editable} className="space-y-3">
          <label className="block space-y-1"><span>{t("codingArtifacts.version")}</span><Input aria-label={t("codingArtifacts.version")} maxLength={100} value={draft.version} onChange={event => update({ ...draft, version: event.target.value })} /></label>
          <p className="text-sm text-muted-foreground">{t("codingArtifacts.pathHelp")}</p>
          {draft.artifacts.map((row, index) => <div key={index} className="space-y-2 rounded-md border border-border p-3">
            {(["path", "buildJob"] as const).map(field => <label key={field} className="block space-y-1"><span>{t(`codingArtifacts.${field}`, { number: index + 1 })}</span><Input aria-label={t(`codingArtifacts.${field}`, { number: index + 1 })} maxLength={field === "path" ? 1000 : 200} value={row[field]} onChange={event => update({ ...draft, artifacts: draft.artifacts.map((item, position) => position === index ? { ...item, [field]: event.target.value } : item) })} /></label>)}
            <div className="flex flex-wrap gap-3">
              <label className="space-y-1"><span>{t("codingArtifacts.platform", { number: index + 1 })}</span><select aria-label={t("codingArtifacts.platform", { number: index + 1 })} className="block rounded-md border border-border bg-background p-2" value={row.platform} onChange={event => update({ ...draft, artifacts: draft.artifacts.map((item, position) => position === index ? { ...item, platform: event.target.value as Artifact["platform"] } : item) })}><option value="linux">Linux</option><option value="windows">Windows</option><option value="macos">macOS</option></select></label>
              <label className="space-y-1"><span>{t("codingArtifacts.arch", { number: index + 1 })}</span><select aria-label={t("codingArtifacts.arch", { number: index + 1 })} className="block rounded-md border border-border bg-background p-2" value={row.arch} onChange={event => update({ ...draft, artifacts: draft.artifacts.map((item, position) => position === index ? { ...item, arch: event.target.value as Artifact["arch"] } : item) })}><option value="x86_64">x86_64</option><option value="arm64">arm64</option></select></label>
            </div>
            <Button variant="outline" disabled={draft.artifacts.length === 1} onClick={() => update({ ...draft, artifacts: draft.artifacts.filter((_, position) => position !== index) })}>{t("codingArtifacts.remove", { number: index + 1 })}</Button>
          </div>)}
          <Button variant="outline" disabled={draft.artifacts.length >= 30} onClick={() => update({ ...draft, artifacts: [...draft.artifacts, freshArtifact()] })}>{t("codingArtifacts.add")}</Button>
        </fieldset>
        {review && !blocked && <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />{t("codingArtifacts.confirm")}</label>}
        {state === "unknown" && <div className="space-y-2">
          <Button variant="outline" disabled={refreshing} onClick={() => { void refresh(); }}>{t("codingArtifacts.refresh")}</Button>
          <label className="flex items-start gap-2"><input type="checkbox" disabled={!inspected || refreshing} checked={reconciled} onChange={event => setReconciled(event.target.checked)} />{t("codingArtifacts.reconciled")}</label>
          <Button variant="outline" disabled={!inspected || !reconciled || refreshing} onClick={newAfterReconciliation}>{t("codingArtifacts.newOperation")}</Button>
        </div>}
      </>}
      <div className="flex items-center justify-between gap-2">
        <Button variant="outline" disabled={pending} onClick={() => { setOpen(false); setReview(false); setConfirmed(false); }}>{t("common.cancel")}</Button>
        {!blocked && (review ? <Button disabled={!confirmed || inFlight.current} onClick={() => { void save(); }}>{t("codingArtifacts.save")}</Button>
          : <Button disabled={!validDraft(draft) || !Number.isSafeInteger(projectId)} onClick={() => { setReview(true); setConfirmed(false); }}>{t("codingArtifacts.review")}</Button>)}
      </div>
    </section>}
  </div>;
}
