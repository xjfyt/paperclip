import { useEffect, useRef, useState } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { NativeSelect } from "./ui/select";

type Policy = { minimumSeverity: "info" | "warning" | "critical"; mergeWindowSeconds: number; mergeMode?: "exact" | "digest" };
export function MimouseNotificationPolicy({ scope, policy, policyVersion, pending, digestSupported, windowSupported, onSave, onReload, labels }: {
  scope: string; policy: Policy; policyVersion: number; pending: boolean; digestSupported: boolean; windowSupported: boolean;
  onSave: (policy: Policy & { expectedVersion: number }) => Promise<unknown>;
  onReload: () => Promise<{ policy: Policy; policyVersion: number }>;
  labels: { mode: string; exact: string; digest: string; digestHelp: string; unavailable: string; windowUnavailable: string; resetWindow: string; severity: string; info: string; warning: string; critical: string; window: string; help: string; save: string; cancel: string; conflict: string; reload: string; error: string };
}) {
  const generation = useRef(0);
  const [mode, setMode] = useState(policy.mergeMode ?? "exact");
  const [baseline, setBaseline] = useState({ policy, policyVersion });
  const [level, setLevel] = useState(policy.minimumSeverity);
  const [window, setWindow] = useState(String(policy.mergeWindowSeconds));
  const [conflicted, setConflicted] = useState(false); const [error, setError] = useState(false); const [busy, setBusy] = useState(false);
  const seconds = Number(window);
  const unsupportedWindow = !windowSupported && (seconds !== 0 || mode !== "exact");
  const valid = !unsupportedWindow && (mode !== "digest" || digestSupported) && window.trim() !== "" && Number.isInteger(seconds) && seconds >= 0 && seconds <= 300;
  const dirty = mode !== (baseline.policy.mergeMode ?? "exact") || level !== baseline.policy.minimumSeverity || seconds !== baseline.policy.mergeWindowSeconds;
  function adopt(value: { policy: Policy; policyVersion: number }) {
    setBaseline(value); setMode(value.policy.mergeMode ?? "exact"); setLevel(value.policy.minimumSeverity); setWindow(String(value.policy.mergeWindowSeconds)); setConflicted(false); setError(false);
  }
  // Polls may refresh clean forms, but never discard an unsaved or conflicted draft.
  useEffect(() => { if (!dirty && !conflicted && !busy && policyVersion > baseline.policyVersion) adopt({ policy, policyVersion }); }, [policy.mergeMode, policy.minimumSeverity, policy.mergeWindowSeconds, policyVersion, dirty, conflicted, busy]);
  useEffect(() => { generation.current++; setBusy(false); adopt({ policy, policyVersion }); }, [scope]);
  async function save() {
    if (busy || pending || conflicted || !valid || !dirty) return;
    setBusy(true); setError(false); const current = generation.current;
    const saved: Policy = { minimumSeverity: level, mergeWindowSeconds: seconds, ...(mode === "digest" ? { mergeMode: mode } : {}) };
    try { await onSave({ ...saved, expectedVersion: baseline.policyVersion }); if (current === generation.current) adopt({ policy: saved, policyVersion: baseline.policyVersion + 1 }); }
    catch (failure) { if (current === generation.current) { setError(true); if ((failure as { status?: number })?.status === 409) setConflicted(true); } }
    finally { if (current === generation.current) setBusy(false); }
  }
  return <div className="space-y-2">
    <p className="text-sm text-muted-foreground">{labels.help}</p>
    {error && <p role="alert">{conflicted ? labels.conflict : labels.error}</p>}
    {conflicted && <Button type="button" variant="outline" disabled={pending || busy} onClick={async () => {
      setBusy(true); const current = generation.current; try { const fresh = await onReload(); if (current === generation.current) adopt(fresh); } catch { if (current === generation.current) setError(true); } finally { if (current === generation.current) setBusy(false); }
    }}>{labels.reload}</Button>}
    <label className="block text-sm">{labels.severity}
      <NativeSelect aria-label={labels.severity} value={level} disabled={pending || busy} onChange={event => setLevel(event.target.value as Policy["minimumSeverity"])}>
        {(["info", "warning", "critical"] as const).map(value => <option key={value} value={value}>{labels[value]}</option>)}
      </NativeSelect>
    </label>
    <label className="block text-sm">{labels.mode}
      <NativeSelect aria-label={labels.mode} value={mode} disabled={pending || busy || !windowSupported} onChange={event => setMode(event.target.value as "exact" | "digest")}>
        <option value="exact">{labels.exact}</option><option value="digest" disabled={!digestSupported}>{labels.digest}</option>
      </NativeSelect>
    </label>
    <p className="text-sm text-muted-foreground">{digestSupported ? labels.digestHelp : labels.unavailable}</p>
    <label className="block text-sm">{labels.window}
      <Input aria-label={labels.window} type="number" min={0} max={300} step={1} value={window} disabled={pending || busy || !windowSupported} onChange={event => setWindow(event.target.value)} aria-invalid={!valid} />
    </label>
    {!windowSupported && <p className="text-sm text-muted-foreground" role={unsupportedWindow ? "alert" : undefined}>{labels.windowUnavailable}</p>}
    {unsupportedWindow && <Button type="button" variant="outline" disabled={pending || busy || conflicted} onClick={() => { setWindow("0"); setMode("exact"); }}>{labels.resetWindow}</Button>}
    <div className="flex items-center justify-between gap-2">
      <Button type="button" variant="ghost" disabled={pending || busy || !dirty || conflicted} onClick={() => adopt(baseline)}>{labels.cancel}</Button>
      <Button type="button" disabled={pending || busy || conflicted || !valid || !dirty} onClick={() => void save()}>{labels.save}</Button>
    </div>
  </div>;
}
