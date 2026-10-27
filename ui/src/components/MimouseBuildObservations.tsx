import { useEffect, useId, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { startMimouseBuildObservationSchema, type MimouseBuildObservationContext, type MimouseBuildObservationPage,
  type MimouseBuildObservationReceipt, type MimouseBuildObservationRequestOutcome, type StartMimouseBuildObservationInput } from "@paperclipai/shared";
import { requestResponse } from "@/api/client";
import { readApiJson } from "@/api/response";
import { readCodingEvidence } from "@/api/coding-read";
import { useTranslation } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Props = { companyId: string; userId: string; sessionId: string; authEpoch: number; deliveryId: string; headSha: string };
type CurrentRequest = { request: MimouseBuildObservationRequestOutcome | null };
export function MimouseBuildObservations(props: Props) {
  return <ObservationPanel key={JSON.stringify([props.companyId, props.userId, props.sessionId, props.authEpoch, props.deliveryId, props.headSha])} {...props} />;
}
function ObservationPanel({ companyId, userId, sessionId, authEpoch, deliveryId, headSha }: Props) {
  const { t } = useTranslation(); const labelId = useId(); const client = useQueryClient();
  const [open, setOpen] = useState(false), [profileId, setProfileId] = useState(""), [jobId, setJobId] = useState("");
  const [request, setRequest] = useState<StartMimouseBuildObservationInput | null>(null);
  const [outcome, setOutcome] = useState<MimouseBuildObservationRequestOutcome | null>(null);
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false), [recovered, setRecovered] = useState(false);
  const [hideEvidence, setHideEvidence] = useState(false);
  const [requestLoaded, setRequestLoaded] = useState(false); const hydrated = useRef(false);
  const active = useRef(true), running = useRef(false), controller = useRef<AbortController | null>(null);
  const root = `/companies/${companyId}/coding/${deliveryId}/build-observations`;
  const key = ["coding-build-observations", companyId, userId, sessionId, authEpoch, deliveryId, headSha];
  const authenticated = Boolean(userId && sessionId && userId !== "local-board" && sessionId !== "local-board");
  const options = { enabled: open && authenticated, gcTime: 0, retry: false, staleTime: 0,
    refetchOnWindowFocus: false, refetchOnReconnect: false } as const;
  const context = useQuery({ ...options, queryKey: [...key, "context"], queryFn: ({ signal }) => readCodingEvidence<MimouseBuildObservationContext>(`${root}/context`, signal) });
  const history = useQuery({ ...options, queryKey: [...key, "history"], queryFn: ({ signal }) => readCodingEvidence<MimouseBuildObservationPage>(root, signal) });
  const current = useQuery({ ...options, queryKey: [...key, "current"], queryFn: ({ signal }) => readCodingEvidence<CurrentRequest>(`${root}/requests/current`, signal) });
  useEffect(() => { active.current = true; return () => { active.current = false; controller.current?.abort(); }; }, []);
  useEffect(() => {
    if (hydrated.current || !current.isSuccess || current.isFetching || current.isError) return;
    hydrated.current = true; setRequestLoaded(true);
    if (current.data.request) { setRequest(current.data.request.input); setOutcome(current.data.request); setRecovered(true); }
    // Initial scoped recovery only. A later refetch must not reinstall a terminal
    // request the user explicitly dismissed with "Prepare a new observation".
  }, [current.data, current.isSuccess, current.isFetching, current.isError]);
  function close() {
    if (running.current) return;
    void client.cancelQueries({ queryKey: key }); setOpen(false);
  }
  const loading = context.isFetching || history.isFetching || current.isFetching;
  const readable = requestLoaded && !hideEvidence && !context.isError && !history.isError && !current.isError && !loading;
  const available = readable && context.data?.enabled ? context.data.profiles.filter(profile => profile.headSha === headSha) : [];
  const selected = available.find(profile => profile.id === profileId) ?? (profileId ? undefined : available[0]);
  const numericJob = jobId.length > 0 && jobId[0] !== "0" && !/[^0-9]/.test(jobId) ? Number(jobId) : NaN;
  const canStart = authenticated && !busy && !request && Boolean(selected) && Number.isSafeInteger(numericJob) && numericJob > 0;

  async function submit(body: StartMimouseBuildObservationInput) {
    if (running.current || !authenticated) return;
    running.current = true; const abort = new AbortController(); controller.current = abort;
    setBusy(true); setFailed(false); setRecovered(false); setOutcome(null); setRequest(body);
    try {
      const response = await requestResponse(root, { method: "POST", cache: "no-store", signal: abort.signal, body: JSON.stringify(body) });
      const result = await readApiJson<MimouseBuildObservationRequestOutcome>(response); abort.signal.throwIfAborted();
      if (active.current && result.requestId === body.requestId) setOutcome(result);
      else if (active.current) { setFailed(true); setHideEvidence(true); }
    } catch { if (active.current) { setFailed(true); setHideEvidence(true); } }
    finally { if (active.current) { running.current = false; setBusy(false); } }
  }
  async function recover() {
    if (running.current || !request || !authenticated) return;
    running.current = true; const abort = new AbortController(); controller.current = abort;
    setBusy(true); setFailed(false); setOutcome(null); setRecovered(false);
    try {
      const result = await readCodingEvidence<MimouseBuildObservationRequestOutcome>(`${root}/requests/${request.requestId}`, abort.signal);
      abort.signal.throwIfAborted();
      if (active.current && result.requestId === request.requestId) { setOutcome(result); setRecovered(true); }
      else if (active.current) { setFailed(true); setHideEvidence(true); }
    } catch { if (active.current) { setFailed(true); setHideEvidence(true); } }
    finally { if (active.current) { running.current = false; setBusy(false); } }
  }
  async function refresh() {
    if (running.current || !authenticated) return;
    running.current = true; setBusy(true); setHideEvidence(true);
    try {
      const results = await Promise.all([context.refetch(), history.refetch(), current.refetch()]);
      if (active.current && results.every(result => !result.error)) {
        setHideEvidence(false);
        const latest = results[2].data?.request;
        if (request && latest?.requestId === request.requestId) { setOutcome(latest); setRecovered(true); }
      }
    } finally { if (active.current) { running.current = false; setBusy(false); } }
  }
  function start() {
    if (!canStart || !selected || running.current) return;
    const body = startMimouseBuildObservationSchema.safeParse({ requestId: crypto.randomUUID(), profileId: selected.id,
      jobId: numericJob, expectedBinding: selected.expectedBinding });
    if (body.success) void submit(body.data);
  }
  return <div>
    <Button variant="outline" aria-expanded={open} aria-controls={`${labelId}-panel`} disabled={busy} onClick={() => open ? close() : setOpen(true)}>{t("buildObservations.title")}</Button>
    {open && <section id={`${labelId}-panel`} className="space-y-3 rounded-lg border border-border p-4">
      <p className="text-sm">{t("buildObservations.boundary")}</p>
      {!authenticated && <p role="alert">{t("buildObservations.loginRequired")}</p>}
      {authenticated && <>
        {loading && <p role="status">{t("common.loading")}</p>}
        {(context.isError || history.isError || current.isError) && <p role="alert">{t("buildObservations.readError")}</p>}
        {readable && context.data && !context.data.enabled && <p>{t("buildObservations.disabled")}</p>}
        {readable && context.data?.enabled && !available.length && <p>{t("buildObservations.unavailable")}</p>}
        {!request && available.length > 0 && <div className="space-y-2">
          <label htmlFor={`${labelId}-profile`}>{t("buildObservations.profile")}</label>
          <select id={`${labelId}-profile`} className="block w-full rounded-md border border-border bg-background p-2" disabled={busy} value={selected?.id ?? ""} onChange={event => setProfileId(event.target.value)}>
            {available.map(profile => <option key={profile.id} value={profile.id}>{profile.id} · {profile.artifactName}</option>)}
          </select>
          {selected && <p>{t("buildObservations.pipeline")}: {selected.pipelineId}</p>}
          <label htmlFor={`${labelId}-job`}>{t("buildObservations.jobId")}</label>
          <Input id={`${labelId}-job`} inputMode="numeric" maxLength={16} value={jobId} disabled={busy} onChange={event => setJobId(event.target.value)} />
          <Button disabled={!canStart} onClick={start}>{t("buildObservations.observe")}</Button>
        </div>}
        {request && <div className="space-y-2">
          <p className="break-all font-mono text-xs">{t("buildObservations.requestId")}: {request.requestId}</p>
          {busy && <p role="status">{t("buildObservations.pending")}</p>}
          {failed && <p role="alert">{t("buildObservations.uncertain")}</p>}
          {outcome && <p>{t(`buildObservations.state.${outcome.state}`)}</p>}
          <Button variant="outline" disabled={busy} onClick={() => { void recover(); }}>{t("buildObservations.recover")}</Button>
          {recovered && outcome?.state === "retryable" && <Button disabled={busy} onClick={() => { if (request && recovered && outcome?.state === "retryable") void submit(request); }}>{t("buildObservations.retry")}</Button>}
          {(outcome?.state === "terminal" || outcome?.state === "interrupted") && <Button variant="outline" disabled={busy} onClick={() => { setRequest(null); setOutcome(null); setRecovered(false); setFailed(false); }}>{t("buildObservations.newRequest")}</Button>}
          {!failed && readable && outcome?.receipt && <Receipt receipt={outcome.receipt} />}
        </div>}
        <Button variant="outline" disabled={busy || loading} onClick={() => { void refresh(); }}>{t("buildObservations.refresh")}</Button>
        <h4 className="font-medium">{t("buildObservations.history")}</h4>
        {readable && history.data && <>{history.data.receipts.length === 0 && <p>{t("buildObservations.empty")}</p>}
          {history.data.receipts.slice(0, 10).map(receipt => <Receipt key={receipt.id} receipt={receipt} />)}</>}
      </>}
    </section>}
  </div>;
}
function Receipt({ receipt }: { receipt: MimouseBuildObservationReceipt }) {
  const { t } = useTranslation(); const proof = receipt.result.provenance;
  return <article className="space-y-1 border-t border-border pt-2 text-sm">
    <p className="break-all font-mono text-xs">{receipt.requestId} · {receipt.profileId} · {receipt.diagnostic}</p>
    <p>{t("buildObservations.recordedAt")}: <time dateTime={receipt.createdAt}>{receipt.createdAt}</time></p>
    {receipt.observedAt && <p>{t("buildObservations.observedAt")}: <time dateTime={receipt.observedAt}>{receipt.observedAt}</time></p>}
    <p>{t(`buildObservations.currentness.${receipt.currentness.status}`)}</p>
    <p className="text-xs">{t("buildObservations.historical")}</p>
    {receipt.result.artifact && <p className="break-all font-mono text-xs">SHA256: {receipt.result.artifact.sha256} · {receipt.result.artifact.sizeBytes} B</p>}
    <p>{t(`buildObservations.provenance.${proof.status}`)}</p>
    {proof.status === "verified_claim" && <>
      <p>{t("buildObservations.buildTimes")}: {proof.startedOn} → {proof.finishedOn}</p>
      <p>{t("buildObservations.verifiedAt")}: {proof.verifiedAt}</p>
    </>}
  </article>;
}
