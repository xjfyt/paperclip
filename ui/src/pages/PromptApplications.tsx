import { useEffect, useRef, useState } from "react";
import type { PromptApplicationRecord, PromptApplicationReceipt, PromptApplicationDispatchReceipt } from "@paperclipai/shared/mimouse-prompt-applications";
import { ApiError } from "@/api/client";
import { promptApplicationsApi, verifyApplicationClosure, type PromptApplicationEvidence, type PromptApplicationHead } from "@/api/prompt-applications";
import { verifyPrivatePromptComparison } from "@/api/private-prompt-comparison";
import { readApplicationJournal, startApplicationJournal, clearApplicationJournal, abandonApplicationPreparation, type PromptApplicationJournal } from "@/lib/prompt-application-journal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatNumber, useTranslation } from "@/i18n";

type Props = { companyId: string; userId: string; sessionId: string; promptId: string | null; authPending?: boolean; evidence: PromptApplicationEvidence | null; onAccessLost: () => void; onPendingChange: (pending: boolean) => void };
const checksKeys = ["confirmOrdinaryVisibility", "confirmBareComparisonNotToolQuality", "confirmNewTasksOnly", "confirmNoAutomaticRun"] as const;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** An auth transition unmounts every private view and aborts all pending requests. */
export function PromptApplications(props: Props) {
  if (!props.companyId || !props.userId || !props.sessionId || props.authPending) return null;
  return <ApplicationSession key={JSON.stringify([props.companyId, props.userId, props.sessionId])} {...props} />;
}
function ApplicationSession(props: Props) {
  const { t } = useTranslation(), label = (key: string) => t(`promptApplicationsUi.${key}`);
  const [items, setItems] = useState<PromptApplicationRecord[]>([]), [nextPage, setNextPage] = useState<string | null>(null);
  const [selected, setSelected] = useState<PromptApplicationRecord | null>(null), [head, setHead] = useState<(PromptApplicationHead & { agentId: string }) | null>(null);
  const [dispatches, setDispatches] = useState<PromptApplicationDispatchReceipt[]>([]), [receipt, setReceipt] = useState<PromptApplicationReceipt | null>(null);
  const [retryReviewed, setRetryReviewed] = useState(false), [retryChecked, setRetryChecked] = useState(false);
  const [dispatchNext, setDispatchNext] = useState<string | null>(null);
  const [agentId, setAgentId] = useState(""), [checks, setChecks] = useState(checksKeys.map(() => false)), [rollbackChecked, setRollbackChecked] = useState(false);
  const [enabled, setEnabled] = useState(false), [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const [journal, setJournal] = useState<PromptApplicationJournal | null>(null), [storageFailed, setStorageFailed] = useState(false), [denied, setDenied] = useState(false);
  const live = useRef(true), generation = useRef(0), controller = useRef<AbortController | null>(null), writeLock = useRef(false), pending = useRef<PromptApplicationJournal | null>(null), storageBroken = useRef(false);
  const currentPrompt = useRef(props.promptId?.toLowerCase()); currentPrompt.current = props.promptId?.toLowerCase();
  function adopt(value: PromptApplicationJournal | null) { pending.current = value; setJournal(value); props.onPendingChange(Boolean(value)); }
  function clearView() { setRetryReviewed(false); setRetryChecked(false); setSelected(null); setHead(null); setDispatches([]); setDispatchNext(null); setReceipt(null); setChecks(checksKeys.map(() => false)); setRollbackChecked(false); }
  function storageFailure() { storageBroken.current = true; setStorageFailed(true); setEnabled(false); clearView(); setNotice("storageFailed"); props.onPendingChange(true); }
  function begin() {
    controller.current?.abort(); const abort = new AbortController(), epoch = ++generation.current; controller.current = abort; setBusy(true);
    const current = () => live.current && generation.current === epoch && !abort.signal.aborted;
    return { current, api: promptApplicationsApi(props.companyId, props.userId, abort.signal) };
  }
  function reject(error: unknown) {
    clearView(); setEnabled(false); setItems([]); setNotice("failed");
    if (error instanceof ApiError && [401, 403].includes(error.status)) {
      controller.current?.abort(); generation.current++; setBusy(false); setAgentId(""); setDenied(true); setJournal(null); props.onAccessLost();
    }
  }
  useEffect(() => {
    live.current = true;
    try { const saved = readApplicationJournal(props.companyId, props.userId); adopt(saved); if (saved) setNotice("unknown"); }
    catch { storageFailure(); }
    return () => { live.current = false; generation.current++; controller.current?.abort(); };
  }, []);
  useEffect(() => {
    clearView(); setItems([]); setAgentId(""); setEnabled(false); setBusy(false); writeLock.current = false;
    if (!writeLock.current && props.promptId) void refresh();
    return () => { generation.current++; controller.current?.abort(); };
  }, [props.promptId]);
  async function refresh(more = false) {
    if (writeLock.current || denied || storageBroken.current || !props.promptId) return;
    const promptId = props.promptId, { current, api } = begin(); clearView();
    try {
      const result = await api.list(promptId, more ? nextPage : null); if (!current()) return;
      setItems(old => more ? [...old, ...result.items.filter(row => !old.some(value => value.id === row.id))] : result.items);
      setNextPage(result.nextBeforeId); setEnabled(result.enabled); if (!pending.current) setNotice("");
    } catch (error) { if (current()) reject(error); }
    finally { if (current()) setBusy(false); }
  }
  async function inspectTarget(value = agentId, application?: PromptApplicationRecord) {
    if (writeLock.current || pending.current || denied || !uuid.test(value)) return;
    const { current, api } = begin(); clearView();
    try {
      const result = await api.head(value); if (!current()) return;
      setHead({ ...result, agentId: value.toLowerCase() }); setEnabled(result.enabled); if (application) setSelected(application);
      setNotice("");
    } catch (error) { if (current()) reject(error); }
    finally { if (current()) setBusy(false); }
  }
  async function readDispatches(more = false) {
    if (!selected || writeLock.current || denied) return;
    const row = selected, { current, api } = begin(); if (!more) setDispatches([]); setChecks(checksKeys.map(() => false)); setRollbackChecked(false);
    try {
      const result = await api.dispatches(row.promptId, row.id, more ? dispatchNext : null); if (!current()) return;
      if (result.items.some(value => value.agentId !== row.agentId)) throw Error("application_dispatch_binding_invalid");
      setDispatches(old => more ? [...old, ...result.items.filter(item => !old.some(value => value.id === item.id))] : result.items); setDispatchNext(result.nextBeforeId); setNotice(result.items.length ? "" : "noDispatches");
    } catch (error) { if (current()) reject(error); }
    finally { if (current()) setBusy(false); }
  }
  function resolve(value: PromptApplicationJournal, application: PromptApplicationRecord | null, result: PromptApplicationReceipt | null) {
    if (value.action === "prepare") {
      if (!application || result || application.requestId !== value.requestId || application.agentId !== value.agentId || application.expectedGeneration !== value.expectedGeneration || JSON.stringify(application.comparison) !== JSON.stringify(value.proposal?.comparison)) throw Error("application_recovery_binding_invalid");
    } else if (!result || result.requestId !== value.requestId || result.applicationId !== value.applicationId || result.agentId !== value.agentId || result.generation !== value.expectedGeneration + 1 || result.action !== (value.action === "approve" ? "configure" : "rollback")) throw Error("application_recovery_binding_invalid");
    clearApplicationJournal(value); adopt(null); clearView(); setNotice(value.action === "prepare" ? "prepared" : value.action === "approve" ? "configured" : "rolledBack");
    if (application && application.promptId === currentPrompt.current) setSelected(application);
    setReceipt(result);
  }
  function abandonPreparation() {
    const value = pending.current; if (!value || busy || writeLock.current || denied || storageFailed) return;
    try { abandonApplicationPreparation(value); adopt(null); clearView(); setNotice("abandonedPrepare"); }
    catch { storageFailure(); }
  }
  async function recover() {
    const value = pending.current; if (!value || writeLock.current || denied || storageFailed) return;
    const { current, api } = begin(); clearView();
    try {
      const expected = value.action === "prepare" ? null : { action: value.action, applicationId: value.applicationId!, agentId: value.agentId, expectedGeneration: value.expectedGeneration };
      const result = expected ? await api.request(value.promptId, value.requestId, expected) : await api.request(value.promptId, value.requestId); if (!current()) return;
      setEnabled(result.enabled);
      if (result.closure) {
        if (!expected || result.application || result.receipt) throw Error("application_closure_binding_invalid");
        verifyApplicationClosure(result.closure, { ...expected, requestId: value.requestId });
        clearApplicationJournal(value); adopt(null); clearView(); setNotice("notAppliedClosed"); return;
      }
      if (!result.application && !result.receipt) { setNotice("unresolved"); return; }
      resolve(value, result.application, result.receipt);
    } catch (error) { if (current()) { if (error instanceof ApiError && [401, 403].includes(error.status)) reject(error); else setNotice("unknown"); } }
    finally { if (current()) setBusy(false); }
  }
  async function inspectRetry() {
    const value = pending.current; if (!value?.applicationId || writeLock.current || denied || storageFailed) return;
    const { current, api } = begin(); clearView();
    try {
      const result = await api.detail(value.promptId, value.applicationId); if (!current()) return;
      if (result.item.agentId !== value.agentId || result.item.approvalDigest !== value.approvalDigest ||
        (value.action === "approve" && (result.item.actorUserId !== props.userId || result.item.expectedGeneration !== value.expectedGeneration))) throw Error("application_retry_binding_invalid");
      setSelected(result.item); setEnabled(result.enabled); setRetryReviewed(true);
    } catch (error) { if (current()) reject(error); }
    finally { if (current()) setBusy(false); }
  }
  async function retrySameRequest() {
    const value = pending.current;
    if (!value || writeLock.current || storageFailed || denied || !retryChecked ||
      (value.action !== "prepare" && !retryReviewed) || (value.action === "approve" && !checks.every(Boolean)) ||
      (value.action === "rollback" && !rollbackChecked)) return;
    writeLock.current = true; const { current, api } = begin(); setRetryChecked(false); setChecks(checksKeys.map(() => false)); setRollbackChecked(false);
    try {
      if (JSON.stringify(readApplicationJournal(props.companyId, props.userId)) !== JSON.stringify(value)) throw Error("application_journal_changed");
    } catch { storageFailure(); writeLock.current = false; setBusy(false); return; }
    try {
      if (value.action === "prepare") {
        const result = await api.prepare(value.promptId, { requestId: value.requestId, agentId: value.agentId, expectedGeneration: value.expectedGeneration, comparison: value.proposal!.comparison, approvalValidForMinutes: value.proposal!.approvalValidForMinutes });
        if (current()) resolve(value, result.item, null);
      } else {
        const result = value.action === "approve" ? await api.approve(value.promptId, value.applicationId!, { requestId: value.requestId, expectedGeneration: value.expectedGeneration, approvalDigest: value.approvalDigest!, confirmOrdinaryVisibility: true, confirmBareComparisonNotToolQuality: true, confirmNewTasksOnly: true, confirmNoAutomaticRun: true }) : await api.rollback(value.promptId, value.applicationId!, { requestId: value.requestId, expectedGeneration: value.expectedGeneration });
        if (current()) resolve(value, null, result.receipt);
      }
    } catch (error) {
      if (current()) {
        if (error instanceof ApiError && [401, 403].includes(error.status)) reject(error);
        else { clearView(); setNotice("unknown"); } // A retry rejection cannot erase an earlier uncertain write.
      }
    } finally { writeLock.current = false; if (current()) setBusy(false); }
  }
  const evidence = props.evidence?.report.promptId === props.promptId?.toLowerCase() ? props.evidence : null;
  async function mutate(action: PromptApplicationJournal["action"]) {
    if (writeLock.current || pending.current || storageFailed || denied || !props.promptId || !head) return;
    const target = selected;
    if (action === "prepare" ? !enabled || !evidence || head.agentId !== agentId.toLowerCase() : !target || target.promptId !== props.promptId.toLowerCase() || target.agentId !== head.agentId) return;
    if (action === "approve" && (target?.actorUserId !== props.userId || !enabled || !checks.every(Boolean) || !target || Date.parse(target.approvalExpiresAt) <= Date.now() || head.generation !== target.expectedGeneration || head.applicationId === target.id)) return;
    if (action === "rollback" && (!rollbackChecked || !target || head.applicationId !== target.id || head.generation !== target.currentGeneration)) return;
    writeLock.current = true; const { current, api } = begin(); setChecks(checksKeys.map(() => false)); setRollbackChecked(false); setReceipt(null); setNotice("");
    let value: PromptApplicationJournal | null = null;
    try {
      if (action === "prepare") {
        const report = verifyPrivatePromptComparison(evidence!.report, props.companyId, props.userId, props.promptId, evidence!.comparison);
        if (!report.eligibleForHumanReview) throw Error("application_evidence_blocked");
      }
      value = startApplicationJournal({ version: 1, companyId: props.companyId, userId: props.userId, originSessionId: props.sessionId, promptId: props.promptId, requestId: crypto.randomUUID(), agentId: head.agentId, action, expectedGeneration: head.generation, applicationId: action === "prepare" ? null : target!.id, approvalDigest: action === "prepare" ? null : target!.approvalDigest, proposal: action === "prepare" ? { comparison: evidence!.comparison, approvalValidForMinutes: 60 } : null });
      adopt(value);
    } catch { if (current()) storageFailure(); writeLock.current = false; if (current()) setBusy(false); return; }
    try {
      if (action === "prepare") {
        const result = await api.prepare(value.promptId, { requestId: value.requestId, agentId: value.agentId, expectedGeneration: value.expectedGeneration, comparison: evidence!.comparison, approvalValidForMinutes: 60 }); if (!current()) return;
        if (result.item.reportHash !== evidence!.report.reportHash || result.item.revisionHash !== evidence!.report.candidate.revisionHash) throw Error("application_report_changed");
        resolve(value, result.item, null);
      } else {
        const result = action === "approve" ? await api.approve(value.promptId, value.applicationId!, { requestId: value.requestId, expectedGeneration: value.expectedGeneration, approvalDigest: value.approvalDigest!, confirmOrdinaryVisibility: true, confirmBareComparisonNotToolQuality: true, confirmNewTasksOnly: true, confirmNoAutomaticRun: true }) : await api.rollback(value.promptId, value.applicationId!, { requestId: value.requestId, expectedGeneration: value.expectedGeneration });
        if (!current()) return; resolve(value, null, result.receipt);
      }
    } catch (error) {
      if (!current()) return;
      if (error instanceof ApiError && [401, 403].includes(error.status)) reject(error);
      else if (error instanceof ApiError && [400, 404, 409, 422].includes(error.status)) {
        try { clearApplicationJournal(value); adopt(null); clearView(); setNotice(error.status === 409 ? "conflict" : "rejected"); } catch { storageFailure(); }
      } else { clearView(); setNotice("unknown"); }
    } finally { writeLock.current = false; if (current()) setBusy(false); }
  }
  const row = selected?.promptId === (journal?.promptId ?? props.promptId?.toLowerCase()) ? selected : null;
  const locked = busy || Boolean(journal) || storageFailed || denied;
  const isCurrent = Boolean(row && head?.applicationId === row.id && head.generation === row.currentGeneration);
  const canApprove = Boolean(row && row.actorUserId === props.userId && enabled && head && head.agentId === row.agentId && head.generation === row.expectedGeneration && head.applicationId !== row.id && Date.parse(row.approvalExpiresAt) > Date.now());
  return <section className="space-y-3 border-t border-border pt-4" aria-label={label("title")}>
    <h2 className="text-lg font-semibold">{label("title")}</h2>
    <p>{label("boundary")}</p><p>{label("proposalVisibility")}</p><p className="text-sm text-muted-foreground">{label("profile")}</p><p>{label("scope")}</p><p>{label("visibility")}</p>
    {notice && <p role="status">{label(notice)}</p>}{!enabled && <p>{label("disabled")}</p>}
    <p className="text-sm text-muted-foreground">{label("workspacePolicyBoundary")}</p>
    {!denied && <>
      <fieldset disabled={locked || !enabled || !props.promptId} className="space-y-2">
        <p>{evidence ? label("evidenceReady") : label("evidenceNeeded")}</p>
        <label className="block">{label("agentId")}<Input aria-label={label("agentId")} className="font-mono" maxLength={36} autoComplete="off" value={agentId} onChange={event => { controller.current?.abort(); generation.current++; setBusy(false); setAgentId(event.target.value); clearView(); }} /></label>
        {!row && <Button variant="outline" disabled={!uuid.test(agentId)} onClick={() => void inspectTarget()}>{label("inspectTarget")}</Button>}
        {head && !row && <p className="font-mono break-all">{label("generation")}: {formatNumber(head.generation)} · {label("binding")}: {head.applicationId ?? "—"}</p>}
        <div className="flex items-center justify-between gap-2"><Button variant="outline" onClick={() => { setAgentId(""); clearView(); }}>{label("clear")}</Button><Button disabled={!evidence || !head || head.agentId !== agentId.toLowerCase()} onClick={() => void mutate("prepare")}>{label("prepare")}</Button></div>
      </fieldset>
      <h3 className="font-medium">{label("history")}</h3>
      <ul>{items.map(item => <li key={item.id} className="break-all"><Button variant="outline" disabled={locked} onClick={() => void inspectTarget(item.agentId, item)}>{item.id}</Button> <span className="font-mono">{item.agentId}</span> · {label(item.configured ? "bindingCurrent" : "notCurrent")}</li>)}</ul>
      {nextPage && <Button variant="outline" disabled={locked} onClick={() => void refresh(true)}>{label("more")}</Button>}
      {row && <div className="space-y-2">
        <h3 className="font-medium">{label("review")}</h3>
        <dl className="font-mono break-all">{[["applicationId", row.id], ["agentId", row.agentId], ["revisionId", row.revisionId], ["revisionHash", row.revisionHash], ["reportHash", row.reportHash], ["retryDataset", row.comparison.datasetId], ["baselineRevisionId", row.comparison.baselineRevisionId], ["testCount", formatNumber(row.comparison.testIds.length)], ["approvalDigest", row.approvalDigest], ["targetDigest", row.snapshot.targetDigest], ["implementationDigest", row.snapshot.implementationDigest], ["environmentId", row.snapshot.environmentId], ["workspacePolicy", row.snapshot.workspacePolicy], ["slot", row.snapshot.slot], ["model", row.snapshot.model], ["approvalExpiresAt", row.approvalExpiresAt], ["generation", formatNumber(row.expectedGeneration)]].map(([key, value]) => <div key={key}><dt>{label(key!)}</dt><dd>{value}</dd></div>)}</dl>
        <dl className="font-mono break-all"><dt>{label("credentialVersions")}</dt>{row.snapshot.credentials.map(credential => <dd key={`${credential.secretId}:${credential.version}`}>{credential.secretId} / {formatNumber(credential.version)}</dd>)}</dl>
        <p>{label("expiryBoundary")}</p><p>{label("contextBoundary")}</p>
        {!head && <Button variant="outline" disabled={locked} onClick={() => void inspectTarget(row.agentId, row)}>{label("inspectTarget")}</Button>}
        <fieldset disabled={journal?.action === "approve" ? busy || storageFailed || !retryReviewed : locked || !canApprove} className="space-y-2">{checksKeys.map((key, index) => <label key={key} className="flex items-start gap-2"><input aria-label={label(key)} type="checkbox" checked={checks[index]} onChange={event => setChecks(old => old.map((value, position) => position === index ? event.target.checked : value))} /><span>{label(key)}</span></label>)}{!journal && <Button disabled={!checks.every(Boolean)} onClick={() => void mutate("approve")}>{label("approve")}</Button>}</fieldset>
        {(isCurrent || (journal?.action === "rollback" && retryReviewed)) && <fieldset disabled={journal ? busy || storageFailed : locked} className="space-y-2"><label className="flex items-start gap-2"><input aria-label={label("confirmRollback")} type="checkbox" checked={rollbackChecked} onChange={event => setRollbackChecked(event.target.checked)} /><span>{label("confirmRollback")}</span></label>{!journal && <Button variant="outline" disabled={!rollbackChecked} onClick={() => void mutate("rollback")}>{label("rollback")}</Button>}</fieldset>}
        <Button variant="outline" disabled={locked} onClick={() => void readDispatches()}>{label("dispatches")}</Button>
      </div>}
      {receipt && <p className="break-all">{label(receipt.action === "configure" ? "configuredReceipt" : "rollbackReceipt")}: <span className="font-mono">{receipt.id} · {formatNumber(receipt.generation)}</span></p>}
      <p className="text-sm text-muted-foreground">{label("dispatchBoundary")}</p><p className="text-sm text-muted-foreground">{label("inputDispositionBoundary")}</p>
      <ul>{dispatches.map(value => <li key={value.id} className="font-mono break-all">{label(value.state === "prepared" ? "dispatchPrepared" : "dispatched")}: {value.runId} · {value.issueId}<br />{label("effectiveContextHash")}: {value.effectiveContextHash}<br />{label("promptHash")}: {value.promptHash ?? "—"}<br />{label("inputDisposition")}: {label(value.inputDisposition === "not_applied_before_input" ? "inputNotApplied" : "inputUnconfirmed")}</li>)}</ul>
      {dispatchNext && <Button variant="outline" disabled={locked} onClick={() => void readDispatches(true)}>{label("moreDispatches")}</Button>}
      {journal && <div className="space-y-2"><p>{label("unknown")}</p><p className="font-mono break-all">{journal.requestId} · {journal.agentId} · {formatNumber(journal.expectedGeneration)}</p><Button variant="outline" disabled={busy || storageFailed} onClick={() => void recover()}>{label("recover")}</Button>
        {journal.applicationId && !retryReviewed && <Button variant="outline" disabled={busy || storageFailed} onClick={() => void inspectRetry()}>{label("reviewRetry")}</Button>}
        {journal.proposal && <p className="font-mono break-all">{label("revisionId")}: {journal.proposal.comparison.candidateRevisionId}<br />{label("retryDataset")}: {journal.proposal.comparison.datasetId}</p>}
        {(journal.action === "prepare" || retryReviewed) && <fieldset disabled={busy || storageFailed} className="space-y-2"><label className="flex items-start gap-2"><input aria-label={label("confirmRetry")} type="checkbox" checked={retryChecked} onChange={event => setRetryChecked(event.target.checked)} /><span>{label("confirmRetry")}</span></label><Button variant="outline" disabled={!retryChecked || (journal.action === "approve" && !checks.every(Boolean)) || (journal.action === "rollback" && !rollbackChecked)} onClick={() => void retrySameRequest()}>{label("retrySameRequest")}</Button></fieldset>}
        {journal.action === "prepare" && <><p className="text-sm text-muted-foreground">{label("abandonPrepareBoundary")}</p><Button variant="outline" disabled={busy || storageFailed} onClick={abandonPreparation}>{label("abandonPrepare")}</Button></>}
      </div>}
      <Button variant="outline" disabled={locked || !props.promptId} onClick={() => void refresh()}>{label("refresh")}</Button>
    </>}
  </section>;
}
