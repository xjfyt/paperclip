import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { appendNotificationEvidenceSchema, notificationEvidenceReceiptInputSchema, notificationEvidenceCategories,
  evaluateNotificationEvidence, type AppendNotificationEvidence, type NotificationEvidenceEvent } from "@paperclipai/shared/notification-evidence";
import type { NotificationVerificationDto, NotificationVerificationScope } from "@paperclipai/shared/notification-verification";
import { notificationVerificationApi as api } from "@/api/notification-verification";
import { authApi } from "@/api/auth";
import { healthApi } from "@/api/health";
import { queryKeys } from "@/lib/queryKeys";
import { useTranslation } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Frozen = { input: AppendNotificationEvidence; scope: NotificationVerificationScope };
function sameReceipt(row: NotificationEvidenceEvent, frozen: Frozen, companyId: string) {
  const input = frozen.input;
  if (!row || !/^[a-f0-9-]{36}$/i.test(row.id) || row.companyId !== companyId || row.action !== input.action || row.targetId !== (input.targetId ?? null) || row.revision !== input.expectedRevision + 1) return false;
  if (!input.receipt) return row.receipt === null;
  if (!row.receipt || row.receipt.domain !== "notification" || row.receipt.manual !== true || row.receipt.machineVerified !== false) return false;
  const { domain: _domain, manual: _manual, machineVerified: _machine, scope, resourceId: _resource, ...claim } = row.receipt;
  const parsed = notificationEvidenceReceiptInputSchema.safeParse(claim);
  return parsed.success && JSON.stringify(parsed.data) === JSON.stringify(input.receipt)
    && Object.entries(frozen.scope).every(([key, value]) => scope?.[key as keyof NotificationVerificationScope] === value);
}
export function MimouseNotificationVerification({ companyId, endpointId, onClose }: { companyId: string; endpointId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const session = useQuery({ queryKey: queryKeys.auth.session, queryFn: authApi.getSession, retry: false });
  const userId = session.data?.user?.id ?? session.data?.session?.userId;
  const health = useQuery({ queryKey: queryKeys.health, queryFn: healthApi.get, enabled: session.isSuccess && !userId, retry: false });
  if (session.isError) return <p role="alert">{t("notificationVerification.readError")}</p>;
  if (session.isPending || session.isFetching || (!userId && health.isPending)) return <p role="status">{t("common.loading")}</p>;
  const identity = userId ? `${userId}:${session.data?.session?.id ?? "session"}` : health.isSuccess && health.data.deploymentMode === "local_trusted" ? "local-board" : null;
  if (!identity) return <p role="alert">{t("notificationVerification.readError")}</p>;
  return <Verification key={`${companyId}:${endpointId}:${identity}:${session.dataUpdatedAt}`} companyId={companyId} endpointId={endpointId} identity={identity} authEpoch={session.dataUpdatedAt} onClose={onClose} />;
}
function Verification({ companyId, endpointId, identity, authEpoch, onClose }: { companyId: string; endpointId: string; identity: string; authEpoch: number; onClose: () => void }) {
  const { t } = useTranslation();
  const key = ["notification-verification", companyId, endpointId, identity, authEpoch];
  const view = useQuery({ queryKey: key, queryFn: ({ signal }) => api.get(companyId, endpointId, signal), retry: false, gcTime: 0, staleTime: 0, refetchOnMount: "always" });
  const history = useInfiniteQuery({ queryKey: [...key, "evidence"], initialPageParam: 0, queryFn: ({ pageParam, signal }) => api.list(companyId, endpointId, pageParam, signal),
    getNextPageParam: page => page.nextRevision ?? undefined, retry: false, gcTime: 0, staleTime: 0, refetchOnMount: "always" });
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const ready = view.isSuccess && history.isSuccess && view.isFetchedAfterMount && history.isFetchedAfterMount && !view.isFetching && !history.isFetching;
  async function refresh() { const results = await Promise.all([view.refetch(), history.refetch()]); if (results.some(result => result.error)) throw Error("refresh_failed"); }
  if (view.isError || history.isError) return <section role="alert"><p>{t("notificationVerification.readError")}</p><Button variant="outline" onClick={() => void refresh().catch(() => {})}>{t("notificationVerification.refresh")}</Button><Button variant="outline" onClick={onClose}>{t("common.cancel")}</Button></section>;
  if (!ready) return <p role="status">{t("common.loading")}</p>;
  const events = history.data.pages.flatMap(page => page.events);
  const complete = !history.hasNextPage;
  const statuses = complete ? evaluateNotificationEvidence(companyId, view.data, events, now) : [];
  const revision = Math.max(0, ...history.data.pages.map(page => page.headRevision));
  const formScope = JSON.stringify([view.data.scope, revision, view.data.credentialStatus, view.data.latestTest, view.data.latestApproval]);
  return <section className="rounded-lg border border-border p-4 space-y-3" aria-label={t("notificationVerification.title")}>
    <h2 className="font-medium">{t("notificationVerification.title")}</h2>
    <p>{t("notificationVerification.boundary")}</p>
    <p>{t("notificationVerification.scope", { version: view.data.scope.configVersion, epoch: view.data.scope.verificationEpoch })}</p>
    <p>{t("notificationVerification.saved")}</p><p>{t(`notificationVerification.credential_${view.data.credentialStatus}`)}</p>
    <p>{t(view.data.endpointEnabled && view.data.dispatchEnabled ? "notificationVerification.enabled" : "notificationVerification.paused")}</p>
    {(["latestTest", "latestApproval"] as const).map(name => { const row = view.data[name]; return <div key={name} className="space-y-1">
      <h3>{t(`notificationVerification.${name}`)}</h3>
      {row ? <><p className="font-mono text-sm break-all">{row.id} · {t(`notifications.state_${row.state}`, { defaultValue: row.state })} · {row.lastCode ?? "—"}</p>
        <p>{row.scopeMatches ? t("notificationVerification.currentScope") : t("notificationVerification.oldScope")}</p>
        {row.review && <p>{t("notificationVerification.oldReview")}: {t(`notifications.observed_${row.review.outcome}`)} · {row.review.actorId} · {row.review.createdAt}</p>}</> : <p>{t("notificationVerification.not_recorded")}</p>}
    </div>; })}
    {statuses.map(status => <p key={status.category}>{t(`notificationVerification.${status.category}`)}: {t(`notificationVerification.${status.status}`)}</p>)}
    {!complete && <><p>{t("notificationVerification.incomplete")}</p><Button variant="outline" onClick={() => void history.fetchNextPage()}>{t("notificationVerification.more")}</Button></>}
    {complete && <Declaration key={formScope} companyId={companyId} endpointId={endpointId} identity={identity} view={view.data} revision={revision} events={events} refresh={refresh} />}
    <details><summary>{t("notificationVerification.history")}</summary>{events.map(event => <div key={event.id} className="space-y-1 border border-border rounded p-2">
      <p className="font-mono text-xs break-all">{event.id} · {event.reviewerId} · {event.createdAt}</p>
      {event.receipt ? <><p>{t(`notificationVerification.${event.receipt.category}`)} · {t(`capabilityEvidence.${event.receipt.result}`)} · {t("notificationVerification.manual")}</p>
        <p>{t("notificationVerification.scope", { version: event.receipt.scope.configVersion, epoch: event.receipt.scope.verificationEpoch })}</p>
        <p className="text-xs break-all">{event.receipt.runtimeVersion} / {event.receipt.environmentAlias} / {event.receipt.accountAlias} / {event.receipt.reportRef}</p>
        <p className="font-mono text-xs break-all">{event.receipt.testedCommit} · {event.receipt.testedAt} → {event.receipt.expiresAt}</p></> : <p>{t("notificationVerification.revoked")}</p>}
    </div>)}</details>
    <div className="flex justify-between"><Button variant="outline" onClick={onClose}>{t("common.cancel")}</Button><Button variant="outline" onClick={() => void refresh().catch(() => {})}>{t("notificationVerification.refresh")}</Button></div>
  </section>;
}
function Declaration({ companyId, endpointId, identity, view, revision, events, refresh }: { companyId: string; endpointId: string; identity: string; view: NotificationVerificationDto; revision: number; events: NotificationEvidenceEvent[]; refresh: () => Promise<void> }) {
  const { t } = useTranslation();
  const storageKey = `paperclip:notification-declaration:${JSON.stringify([companyId, identity, endpointId])}`;
  const [stored] = useState(() => { try { return { value: sessionStorage.getItem(storageKey), error: false }; } catch { return { value: null, error: true }; } });
  const [frozen, setFrozen] = useState<Frozen | null>(() => {
    try {
      if (!stored.value) return null;
      const value = JSON.parse(stored.value), input = appendNotificationEvidenceSchema.parse(value.input), scope = value.scope;
      if (!scope || scope.endpointId !== endpointId || scope.configVersion !== input.expectedConfigVersion || scope.verificationEpoch !== input.expectedEpoch
        || typeof scope.kind !== "string" || typeof scope.secretRef !== "string" || !Number.isSafeInteger(scope.secretVersion) || scope.secretVersion < 1) return null;
      return { input, scope };
    } catch { return null; }
  });
  const [mode, setMode] = useState<"draft" | "confirm" | "pending" | "unknown" | "saved" | "denied">(stored.value ? "unknown" : "draft");
  const [error, setError] = useState(stored.error ? "storageError" : "");
  const [confirmed, setConfirmed] = useState(false);
  const active = useRef(true), sending = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const [category, setCategory] = useState<(typeof notificationEvidenceCategories)[number]>("protocol_report");
  const [result, setResult] = useState<"passed" | "failed" | "blocked">("passed");
  const [fields, setFields] = useState({ runtimeVersion: "", environmentAlias: "", accountAlias: "", reportRef: "", testedCommit: "", testedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString() });
  const [real, setReal] = useState(false), [approvalChecks, setApprovalChecks] = useState(false);
  function prepare(action: "record" | "revoke", targetId?: string) {
    const observation = category === "approval_scenario" ? view.latestApproval : view.latestTest;
    const parsed = appendNotificationEvidenceSchema.safeParse({ expectedRevision: revision, idempotencyKey: crypto.randomUUID(), expectedConfigVersion: view.scope.configVersion, expectedEpoch: view.scope.verificationEpoch, confirm: true,
      action, reason: action === "revoke" ? "incorrect" : "verification", ...(targetId ? { targetId } : {}), ...(action === "record" ? { receipt: { ...fields, category, result,
        ...(category === "protocol_report" ? {} : { deliveryId: observation?.id, reviewId: observation?.review?.id, expectedState: observation?.state, expectedAttempt: observation?.attempt, confirmRealTarget: real ? true : undefined }),
        ...(category === "approval_scenario" && approvalChecks ? { approvalChecks: { received: true, detailLink: true, permissionChecked: true, noGetAction: true } } : {}),
      } } : {}) });
    if (!parsed.success) { setError("invalid"); return; }
    setFrozen({ input: parsed.data, scope: view.scope }); setConfirmed(false); setError(""); setMode("confirm");
  }
  async function submit() {
    if (!frozen || sending.current || !confirmed) return;
    const raw = JSON.stringify(frozen);
    try {
      const existing = sessionStorage.getItem(storageKey);
      if (existing && existing !== raw) { setMode("unknown"); setFrozen(null); setError("ownershipChanged"); return; }
      sessionStorage.setItem(storageKey, raw);
    } catch { setError("storageError"); return; }
    sending.current = true; setMode("pending"); setError("");
    const clearOwned = () => { if (sessionStorage.getItem(storageKey) === raw) sessionStorage.removeItem(storageKey); };
    try {
      const row = await api.append(companyId, endpointId, frozen.input);
      if (!active.current) return;
      if (!sameReceipt(row, frozen, companyId)) { setMode("unknown"); setConfirmed(false); return; }
      clearOwned(); setMode("saved"); setFrozen(null); setConfirmed(false);
      try { await refresh(); } catch { if (active.current) setError("refreshError"); }
    } catch (failure) {
      if (!active.current) return;
      const status = (failure as { status?: number }).status;
      if ([400, 401, 403, 404, 409, 422].includes(status ?? 0)) {
        try { clearOwned(); } catch { setMode("unknown"); setError("storageError"); return; }
        setFrozen(null); setConfirmed(false); setMode("denied"); setError("rejected");
      } else { setMode("unknown"); setConfirmed(false); setError("unknown"); }
    } finally { sending.current = false; }
  }
  if (mode === "saved" || mode === "denied") return <p role={mode === "denied" ? "alert" : "status"}>{t(`notificationVerification.${error || "savedDeclaration"}`)}</p>;
  const busy = mode === "pending";
  return <div className="space-y-3 border border-border rounded p-3" aria-label={t("notificationVerification.declare")}>
    {error && <p role="alert">{t(`notificationVerification.${error}`)}</p>}
    {mode === "unknown" && <p role="alert">{t("notificationVerification.unknown")}</p>}
    {mode === "draft" ? <>
      <h3>{t("notificationVerification.declare")}</h3>
      <label>{t("notificationVerification.category")}<select aria-label={t("notificationVerification.category")} className="rounded border border-border bg-background p-2" value={category} onChange={event => { setCategory(event.target.value as typeof category); setReal(false); setApprovalChecks(false); }}>{notificationEvidenceCategories.map(value => <option key={value} value={value}>{t(`notificationVerification.${value}`)}</option>)}</select></label>
      <label>{t("notificationVerification.result")}<select aria-label={t("notificationVerification.result")} className="rounded border border-border bg-background p-2" value={result} onChange={event => setResult(event.target.value as typeof result)}>{(["passed", "failed", "blocked"] as const).map(value => <option key={value} value={value}>{t(`capabilityEvidence.${value}`)}</option>)}</select></label>
      {(Object.keys(fields) as Array<keyof typeof fields>).map(field => <label key={field} className="block">{t(`notificationVerification.${field}`)}<Input aria-label={t(`notificationVerification.${field}`)} value={fields[field]} onChange={event => setFields({ ...fields, [field]: event.target.value })} /></label>)}
      {category !== "protocol_report" && <label className="flex gap-2"><input type="checkbox" checked={real} onChange={event => setReal(event.target.checked)} />{t("notificationVerification.realTarget")}</label>}
      {category === "approval_scenario" && <label className="flex gap-2"><input type="checkbox" checked={approvalChecks} onChange={event => setApprovalChecks(event.target.checked)} />{t("notificationVerification.approvalChecks")}</label>}
      <Button disabled={view.credentialStatus !== "metadata_active" || stored.error} onClick={() => prepare("record")}>{t("notificationVerification.prepare")}</Button>
      {events.filter(event => event.receipt && !events.some(other => other.targetId === event.id)).map(event => <Button key={event.id} variant="outline" onClick={() => prepare("revoke", event.id)}>{t("notificationVerification.revoke")} · {event.id}</Button>)}
    </> : frozen ? <>
      <p>{t("notificationVerification.manual")}</p><pre className="text-xs whitespace-pre-wrap break-all">{JSON.stringify(frozen.input, null, 2)}</pre>
      <label className="flex gap-2"><input type="checkbox" disabled={busy} checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />{t("notificationVerification.confirm")}</label>
      <div className="flex justify-between">{mode === "confirm" ? <Button variant="outline" onClick={() => { setMode("draft"); setFrozen(null); setConfirmed(false); }}>{t("common.cancel")}</Button> : <span />}
        <Button disabled={busy || !confirmed} onClick={() => void submit()}>{t(busy ? "common.loading" : mode === "unknown" ? "notificationVerification.retrySame" : "notificationVerification.save")}</Button></div>
    </> : <p>{t("notificationVerification.manualRecovery")}</p>}
  </div>;
}
