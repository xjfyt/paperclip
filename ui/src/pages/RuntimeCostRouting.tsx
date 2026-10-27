import { useEffect, useRef, useState } from "react";
import { runtimeRoutingPolicySchema, createRuntimeRoutingTaskSchema, type CreateRuntimeRoutingTask, type RuntimeRoutingRequestQuery } from "@paperclipai/shared/runtime-cost-routing";
import { runtimeCostRoutingApi, type RuntimePolicyRecord, type RuntimeBinding, type RuntimeCurrent } from "@/api/runtime-cost-routing";
import { ApiError } from "@/api/client";
import { readActorRoutingJournal, rememberRoutingBinding, readRoutingBindingReference, clearRoutingJournal, readRoutingJournal, startRoutingJournal, routingInputDigest, type RoutingJournal, type RoutingScope } from "@/lib/runtime-cost-routing-journal";
import { applyCompanyPrefix } from "@/lib/company-routes";
import { createIssueDetailPath } from "@/lib/issueDetailBreadcrumb";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatNumber, useTranslation } from "@/i18n";

type Props = RoutingScope & { authPending?: boolean; companyPrefix?: string | null };
const approvalChecks = ["confirmBare", "confirmHistorical", "confirmNew", "confirmNoRun", "confirmAudience"] as const;
const bindingStateLabels: Record<RuntimeBinding["state"], string> = { bound: "bindingBound", wake_pending: "bindingWakePending", run_claimed: "bindingRunClaimed", start_requested: "bindingStartRequested" };
type Api = ReturnType<typeof runtimeCostRoutingApi>;
/** Identity, authorization epoch and company transitions destroy plaintext and checked intent. */
export function RuntimeCostRouting(props: Props) {
  if (props.authPending || !props.companyId || !props.userId || !props.sessionId) return null;
  return <RoutingSession key={JSON.stringify([props.companyId, props.userId, props.sessionId, props.authEpoch])} {...props} />;
}
function RoutingSession(scope: Props) {
  const { t } = useTranslation(), label = (key: string) => t(`runtimeCostRoutingUi.${key}`);
  const [head, setHead] = useState<RuntimeCurrent | null>(null), [proposal, setProposal] = useState<RuntimePolicyRecord | null>(null);
  const [binding, setBinding] = useState<RuntimeBinding | null>(null), [draft, setDraft] = useState("");
  const [title, setTitle] = useState(""), [description, setDescription] = useState("");
  const [checks, setChecks] = useState(approvalChecks.map(() => false)), [taskChecked, setTaskChecked] = useState(false);
  const [runChecked, setRunChecked] = useState(false), [disableChecked, setDisableChecked] = useState(false), [retryChecked, setRetryChecked] = useState(false);
  const [closeChecked, setCloseChecked] = useState(false);
  const [journal, setJournal] = useState<RoutingJournal | null>(null), [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const [denied, setDenied] = useState(false), [storageFailed, setStorageFailed] = useState(false);
  const live = useRef(true), epoch = useRef(0), controller = useRef<AbortController | null>(null), lock = useRef(false);
  const pending = useRef<RoutingJournal | null>(null), storageBroken = useRef(false), taskPayload = useRef<CreateRuntimeRoutingTask | null>(null);
  function adopt(value: RoutingJournal | null) { pending.current = value; setJournal(value); }
  function clearChecks() { setChecks(approvalChecks.map(() => false)); setTaskChecked(false); setRunChecked(false); setDisableChecked(false); setRetryChecked(false); setCloseChecked(false); }
  function clearPrivate() { setHead(null); setProposal(null); setBinding(null); setDraft(""); setTitle(""); setDescription(""); taskPayload.current = null; clearChecks(); setReviewed(false); }
  function storageError() { storageBroken.current = true; setStorageFailed(true); clearPrivate(); setNotice("storageFailed"); }
  function reject(error: unknown) {
    if (error instanceof ApiError && [401, 403].includes(error.status)) { controller.current?.abort(); epoch.current++; clearPrivate(); setDenied(true); setNotice("notAuthorized"); setBusy(false); }
    else setNotice(pending.current ? "unknown" : "error");
  }
  function begin() {
    controller.current?.abort(); const abort = new AbortController(), generation = ++epoch.current; controller.current = abort; setBusy(true);
    return { api: runtimeCostRoutingApi(scope.companyId, scope.userId, abort.signal), current: () => live.current && epoch.current === generation && !abort.signal.aborted };
  }
  useEffect(() => {
    live.current = true;
    try { const value = readRoutingJournal(scope); adopt(value); if (value) setNotice("unknown"); }
    catch { storageError(); }
    void refresh();
    return () => { live.current = false; epoch.current++; controller.current?.abort(); taskPayload.current = null; };
  }, []);
  async function refresh() {
    if (lock.current || denied || storageBroken.current) return;
    const { api, current } = begin(); clearChecks(); setHead(null); setProposal(null); setBinding(null); setReviewed(false);
    try {
      let result = await api.current(); if (!current()) return;
      const prior = readActorRoutingJournal(scope); adopt(prior); if (prior) setNotice("unknown");
      const knownId = readRoutingBindingReference(scope);
      let known: { binding: RuntimeBinding } | null = null;
      if (knownId) {
        try { known = await api.binding(knownId); }
        catch { if (!current()) return; result = await api.current(); if (!current()) return; setHead(result); setNotice(prior ? "unknown" : "bindingUnavailable"); return; }
      }
      if (!current()) return; setHead(result); setBinding(known?.binding ?? null); if (!prior) setNotice("");
    }
    catch (error) { if (current()) reject(error); }
    finally { if (current()) setBusy(false); }
  }
  function queryFor(value: RoutingJournal): RuntimeRoutingRequestQuery {
    if (value.action === "run") return { action: "run", bindingId: value.bindingId };
    return { action: value.action, expectedGeneration: value.payload.expectedGeneration, ...(value.action === "approve" ? { policyId: value.policyId } : {}) };
  }
  function resolved(value: RoutingJournal, result: { policy?: RuntimePolicyRecord | null; receipt?: { id: string; policyId: string } | null; binding?: RuntimeBinding | null }) {
    if (value.action === "prepare" && (!result.policy || JSON.stringify(result.policy.policy) !== JSON.stringify(value.payload.policy))) throw Error("routing_recovery_policy_mismatch");
    if ((value.action === "approve" || value.action === "disable") && result.receipt?.policyId !== value.policyId) throw Error("routing_recovery_receipt_mismatch");
    if (value.action === "create_task" && result.binding?.policyId !== value.policyId) throw Error("routing_recovery_task_mismatch");
    if (value.action === "run" && result.binding?.id !== value.bindingId) throw Error("routing_recovery_run_mismatch");
    if (result.binding) rememberRoutingBinding(scope, result.binding.id);
    clearRoutingJournal(value); adopt(null); setReviewed(false); clearChecks();
    if (result.policy) setProposal(result.policy);
    if (result.binding) setBinding(result.binding);
    setNotice({ prepare: "prepared", approve: "approved", disable: "disabledPolicy", create_task: "taskCreated", run: "runRequested" }[value.action]);
    if (value.action === "create_task") { setTitle(""); setDescription(""); taskPayload.current = null; }
  }
  async function recover() {
    const value = pending.current; if (!value || lock.current || busy || denied || storageBroken.current) return;
    const { api, current } = begin(); setReviewed(false); clearChecks(); setProposal(null); setBinding(null); setHead(null);
    try {
      const latest = await api.current(); if (!current()) return; setHead(latest);
      const result = await api.request(value.requestId, queryFor(value)); if (!current()) return;
      setHead({ ...latest, enabled: result.enabled, companyPaused: result.companyPaused });
      if (result.closure) { clearRoutingJournal(value); adopt(null); taskPayload.current = null; setNotice("closed"); return; }
      if (result.policy || result.receipt || result.binding) {
        resolved(value, result);
        if (value.action === "approve" || value.action === "disable") { const next = await api.current(); if (current()) setHead(next); }
        return;
      }
      if (value.action === "approve") {
        const fresh = await api.policy(value.policyId); if (!current()) return;
        if (fresh.item.actorUserId !== scope.userId || fresh.item.approvalDigest !== value.payload.approvalDigest || fresh.item.expectedGeneration !== value.payload.expectedGeneration) throw Error("routing_retry_proposal_mismatch");
        setProposal(fresh.item); setHead({ ...latest, enabled: fresh.enabled, companyPaused: fresh.companyPaused });
      }
      if (value.action === "run") { const fresh = await api.binding(value.bindingId); if (!current()) return; setBinding(fresh.binding); }
      setReviewed(true); setNotice("unresolved");
    } catch (error) { if (current()) reject(error); }
    finally { if (current()) setBusy(false); }
  }
  const canCloseExpired = Boolean(journal?.action === "approve" && reviewed && proposal?.id === journal.policyId
    && proposal.actorUserId === scope.userId && proposal.approvalClosedAt === null && head?.policyId !== proposal.id
    && head?.generation === journal.payload.expectedGeneration);
  async function closeExpired() {
    const value = pending.current;
    if (!value || value.action !== "approve" || !canCloseExpired || !closeChecked || lock.current || busy || denied || storageBroken.current) return;
    lock.current = true; const { api, current } = begin(); clearChecks(); setReviewed(false); setProposal(null); setNotice("");
    try {
      // This is a new, idempotent close intent (policy ID + generation), never an
      // old-session approval replay. Preserve that approval's journal verbatim.
      if (JSON.stringify(readRoutingJournal(value)) !== JSON.stringify(value)) throw Error("routing_journal_changed");
      const latest = await api.current(); if (!current()) return; setHead(latest);
      if (latest.policyId !== value.policyId && latest.generation === value.payload.expectedGeneration) {
        try { await api.closeExpired(value.policyId, { expectedGeneration: value.payload.expectedGeneration }); }
        catch (error) { if (!current()) return; if (error instanceof ApiError && [401, 403].includes(error.status)) { reject(error); return; } }
      }
      if (!current()) return;
      // Even a lost/rejected POST is followed only by readback. POST success alone
      // never releases the pending approval or claims to have cancelled a run.
      const result = await api.request(value.requestId, queryFor(value)); if (!current()) return;
      if (result.closure) { clearRoutingJournal(value); adopt(null); setNotice("closed"); }
      else if (result.receipt) { resolved(value, result); const fresh = await api.current(); if (current()) setHead(fresh); }
      else setNotice("unknown");
    } catch (error) { if (current()) reject(error); }
    finally { lock.current = false; if (current()) setBusy(false); }
  }
  const allowed = Boolean(head?.enabled && !head.companyPaused);
  const canApprove = Boolean(allowed && proposal && proposal.actorUserId === scope.userId && proposal.approvalClosedAt === null && head?.generation === proposal.expectedGeneration && Date.parse(proposal.approvalExpiresAt) > Date.now());
  const canCreate = Boolean(allowed && head?.policy?.actorUserId === scope.userId);
  const canRun = Boolean(canCreate && binding?.state === "bound" && binding.policyId === head?.policyId && binding.generation === head.generation);
  function intent(action: RoutingJournal["action"]) {
    if (!head || denied || storageBroken.current) return false;
    if (action === "disable") return Boolean(head.policyId && disableChecked);
    if (!allowed) return false;
    if (action === "approve") return canApprove && checks.every(Boolean);
    if (action === "create_task") return canCreate && taskChecked;
    if (action === "run") return canRun && runChecked;
    return true;
  }
  async function send(api: Api, value: RoutingJournal) {
    switch (value.action) {
      case "prepare": return { policy: (await api.prepare(value.payload)).item };
      case "approve": return { receipt: (await api.approve(value.policyId, { ...value.payload, confirmBareTextProxy: true, confirmHistoricalCostNotQuote: true, confirmNewTasksOnly: true, confirmNoAutomaticRun: true })).receipt };
      case "disable": return { receipt: (await api.disable(value.payload)).receipt };
      case "create_task": {
        const body = taskPayload.current;
        if (!body || body.requestId !== value.requestId || await routingInputDigest(body.title, body.description) !== value.inputDigest) throw Error("routing_exact_task_payload_missing");
        return { binding: (await api.createTask(body)).binding };
      }
      case "run": return { binding: (await api.run(value.bindingId, { requestId: value.requestId, confirmExecution: true, confirmPossibleCharges: true })).binding };
    }
  }
  async function mutate(action: RoutingJournal["action"], retry = false) {
    if (lock.current || busy || !intent(action) || (retry ? !pending.current || !reviewed || !retryChecked : pending.current)) return;
    if (retry && (pending.current!.sessionId !== scope.sessionId || pending.current!.action !== action || (action === "create_task" && !taskPayload.current))) return;
    lock.current = true; const { api, current } = begin(); setNotice(""); setReviewed(false); clearChecks();
    let value = retry ? pending.current : null;
    try {
      if (value) {
        if (JSON.stringify(readRoutingJournal(scope)) !== JSON.stringify(value)) throw Error("routing_journal_changed");
      } else {
        const requestId = crypto.randomUUID(), base = { version: 2 as const, companyId: scope.companyId, userId: scope.userId, sessionId: scope.sessionId, authEpoch: scope.authEpoch, requestId };
        const expectedGeneration = head!.generation;
        if (action === "prepare") value = { ...base, action, payload: { requestId, expectedGeneration, policy: runtimeRoutingPolicySchema.parse(JSON.parse(draft)), approvalValidForMinutes: 60 } };
        else if (action === "approve") value = { ...base, action, policyId: proposal!.id, payload: { requestId, expectedGeneration, approvalDigest: proposal!.approvalDigest } };
        else if (action === "disable") value = { ...base, action, policyId: head!.policyId!, payload: { requestId, expectedGeneration } };
        else if (action === "create_task") {
          const body = createRuntimeRoutingTaskSchema.parse({ requestId, expectedGeneration, title, description, confirmOrdinaryTaskVisibility: true });
          const inputDigest = await routingInputDigest(body.title, body.description); if (!current()) return; taskPayload.current = body;
          value = { ...base, action, policyId: head!.policyId!, inputDigest, payload: { requestId, expectedGeneration } };
        } else value = { ...base, action: "run", bindingId: binding!.id, payload: { requestId } };
        if (!current()) return;
        value = startRoutingJournal(value); adopt(value);
      }
    } catch (error) {
      if (current()) { if (error instanceof SyntaxError || (error && typeof error === "object" && "issues" in error)) setNotice("invalid"); else storageError(); }
      lock.current = false; if (current()) setBusy(false); return;
    }
    try {
      const result = await send(api, value!); if (!current()) return; resolved(value!, result);
      if (action === "approve" || action === "disable") { const next = await api.current(); if (current()) setHead(next); }
    } catch (error) { if (current()) { clearChecks(); reject(error); } }
    finally { lock.current = false; if (current()) setBusy(false); }
  }
  const taskHref = binding && binding.companyId === scope.companyId.toLowerCase() && scope.companyPrefix?.trim()
    ? applyCompanyPrefix(createIssueDetailPath(binding.issueId), scope.companyPrefix) : null;
  const locked = busy || Boolean(journal) || storageFailed || denied;
  function check(key: string, checked: boolean, onChange: (checked: boolean) => void, disabled = false) {
    return <label className="flex items-start gap-2"><input type="checkbox" aria-label={label(key)} checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} /><span>{label(key)}</span></label>;
  }
  return <section className="space-y-4 border-t border-border pt-4" aria-label={label("title")}>
    <h2 className="text-xl font-semibold">{label("title")}</h2>
    <p>{label("boundary")}</p><p className="text-sm text-muted-foreground">{label("profile")}</p><p>{label("historyCost")}</p><p>{label("privacy")}</p><p>{label("unsupported")}</p>
    {notice && <p role={denied || storageFailed ? "alert" : "status"}>{label(notice)}</p>}
    {busy && <p role="status">{label("pending")}</p>}
    {!denied && !storageFailed && <>
      {!head && !busy && <p>{label("loading")}</p>}
      {head && <><p>{label("generation")}: <span className="font-mono">{formatNumber(head.generation)}</span></p>
        {!head.enabled && <p>{label("defaultOff")}</p>}{head.companyPaused && <p>{label("paused")}</p>}
        {head.policyId ? <p className="break-all">{label("policyId")}: <span className="font-mono">{head.policyId}</span></p> : <p>{label("noPolicy")}</p>}
      </>}
      <fieldset disabled={locked || !allowed} className="space-y-2">
        <label className="block space-y-2"><span>{label("policyInput")}</span><textarea aria-label={label("policyInput")} className="min-h-32 w-full rounded-md border border-border bg-background p-3 font-mono text-xs" value={draft} onChange={event => { setDraft(event.target.value); setProposal(null); clearChecks(); }} /></label>
        <Button disabled={!draft.trim()} onClick={() => void mutate("prepare")}>{label("prepare")}</Button>
      </fieldset>
      {(proposal ?? head?.policy) && <Evidence record={(proposal ?? head!.policy)!} />}
      {proposal && <fieldset disabled={busy || !canApprove || Boolean(journal && (journal.action !== "approve" || !reviewed))} className="space-y-2">
        {approvalChecks.map((key, index) => <div key={key}>{check(key, checks[index]!, checked => setChecks(old => old.map((value, position) => position === index ? checked : value)))}</div>)}
        {!canApprove && <p>{label("proposalExpired")}</p>}
        {!journal && <Button disabled={!checks.every(Boolean)} onClick={() => void mutate("approve")}>{label("approve")}</Button>}
      </fieldset>}
      <p>{label("disableBoundary")}</p>
      {head?.policyId && <fieldset disabled={busy || Boolean(journal && (journal.action !== "disable" || !reviewed))} className="space-y-2">
        {check("confirmDisable", disableChecked, setDisableChecked)}{!journal && <Button variant="outline" disabled={!disableChecked} onClick={() => void mutate("disable")}>{label("disable")}</Button>}
      </fieldset>}
      <p>{label("taskVisibility")}</p>
      <fieldset disabled={locked || !canCreate} className="space-y-2">
        <label className="block">{label("taskTitle")}<Input aria-label={label("taskTitle")} maxLength={512} autoComplete="off" value={title} onChange={event => { setTitle(event.target.value); setTaskChecked(false); }} /></label>
        <label className="block">{label("taskDescription")}<textarea aria-label={label("taskDescription")} maxLength={20000} className="min-h-24 w-full rounded-md border border-border bg-background p-3" value={description} onChange={event => { setDescription(event.target.value); setTaskChecked(false); }} /></label>
        {check("confirmTask", taskChecked, setTaskChecked)}
        <Button disabled={!taskChecked || !title.trim()} onClick={() => void mutate("create_task")}>{label("createTask")}</Button>
      </fieldset>
      <p>{label("runBoundary")}</p>
      {binding && <div className="space-y-2">{!canRun && binding.state === "bound" && <p>{label("boundPolicyInactive")}</p>}<p>{label("bindingState")}: <span>{label(bindingStateLabels[binding.state])}</span></p>
        <p className="text-sm text-muted-foreground">{label("bindingWitnessBoundary")}</p>
        {taskHref && <a className="text-primary underline underline-offset-4" href={taskHref}>{label("openTask")}</a>}
        <dl className="font-mono break-all">{[["bindingId", binding.id], ["taskId", binding.issueId], ["agent", binding.selectedAgentId], ["policyId", binding.policyId]].map(([key, value]) => <div key={key}><dt>{label(key!)}</dt><dd>{value}</dd></div>)}</dl>
        <fieldset disabled={busy || !canRun || Boolean(journal && (journal.action !== "run" || !reviewed))} className="space-y-2">
          {check("confirmRun", runChecked, setRunChecked)}{!journal && <Button disabled={!runChecked} onClick={() => void mutate("run")}>{label("run")}</Button>}
        </fieldset></div>}
      {journal && <div className="space-y-2"><p>{label("unknown")}</p><p className="font-mono break-all">{label("requestId")}: {journal.requestId}</p>
        <Button variant="outline" disabled={busy} onClick={() => void recover()}>{label("recover")}</Button>
        {journal.action === "approve" && <div className="space-y-2"><p>{label("closeExpiredBoundary")}</p>
          <fieldset disabled={busy || !canCloseExpired} className="space-y-2">{check("confirmCloseExpired", closeChecked, setCloseChecked)}
            <Button variant="outline" disabled={!closeChecked} onClick={() => void closeExpired()}>{label("closeExpired")}</Button>
          </fieldset></div>}
        {journal.sessionId !== scope.sessionId && <p>{label("previousSessionPending")}</p>}
        {journal.action === "create_task" && !taskPayload.current && <p>{label("retryUnavailable")}</p>}
        {reviewed && journal.sessionId === scope.sessionId && <fieldset disabled={busy || (journal.action !== "disable" && !allowed)} className="space-y-2">
          {journal.action === "create_task" && taskPayload.current && check("confirmTask", taskChecked, setTaskChecked)}
          {check("confirmRetry", retryChecked, setRetryChecked)}
          <Button variant="outline" disabled={!retryChecked || !intent(journal.action) || (journal.action === "create_task" && !taskPayload.current)} onClick={() => void mutate(journal.action, true)}>{label("retry")}</Button>
        </fieldset>}
      </div>}
      <Button variant="outline" disabled={busy || Boolean(journal)} onClick={() => void refresh()}>{label("refresh")}</Button>
    </>}
  </section>;
}
function Evidence({ record }: { record: RuntimePolicyRecord }) {
  const { t } = useTranslation(), label = (key: string) => t(`runtimeCostRoutingUi.${key}`);
  return <div className="space-y-2"><h3 className="font-semibold">{label("candidates")}</h3><p className="font-mono break-all">{record.id} · {record.approvalDigest}</p>
    <dl className="break-all">{[["datasetId", record.policy.datasetId], ["datasetHash", record.policy.datasetHash], ["minimumPassRate", formatNumber(record.policy.minimumPassRate, { style: "percent" })], ["maxEvidenceAgeHours", formatNumber(record.policy.maxEvidenceAgeHours)], ["approvalExpiresAt", record.approvalExpiresAt]].map(([key, value]) => <div key={key}><dt>{label(key!)}</dt><dd className="font-mono">{value}</dd></div>)}</dl>
    <ul className="space-y-3">{record.candidates.map(({ candidate, evidence, target }) => <li key={candidate.agentId} className="break-all">
      <p>{label(evidence.passedCases / evidence.totalCases >= record.policy.minimumPassRate ? "proxyThresholdMet" : "proxyThresholdNotMet")} · <span className="font-mono">{formatNumber(evidence.passedCases)}/{formatNumber(evidence.totalCases)}</span></p>
      <dl>{[["agent", candidate.agentId], ["promptId", candidate.promptId], ["revisionId", candidate.comparison.candidateRevisionId], ["applicationId", candidate.applicationId], ["targetDigest", target.targetDigest], ["environmentId", target.environmentId], ["profileHash", evidence.profileHash], ["model", evidence.model], ["provider", evidence.provider], ["applicationGeneration", formatNumber(candidate.applicationGeneration)], ["historicalCost", `${evidence.observedCostCents} ${label("usdCents")}`]].map(([key, value]) => <div key={key}><dt>{label(key!)}</dt><dd className="font-mono">{value}</dd></div>)}</dl>
    </li>)}</ul>
  </div>;
}
