import { useEffect, useState } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { NativeSelect } from "./ui/select";

type Policy = { minimumSeverity: "info" | "warning" | "critical"; mergeWindowSeconds: number };
export function MimouseNotificationPolicy({ scope, policy, policyVersion, pending, onSave, onReload, labels }: {
  scope: string; policy: Policy; policyVersion: number; pending: boolean;
  onSave: (policy: Policy & { expectedVersion: number }) => Promise<unknown>;
  onReload: () => Promise<{ policy: Policy; policyVersion: number }>;
  labels: { severity: string; info: string; warning: string; critical: string; window: string; help: string; save: string; cancel: string; conflict: string; reload: string; error: string };
}) {
  const [baseline, setBaseline] = useState({ policy, policyVersion });
  const [level, setLevel] = useState(policy.minimumSeverity);
  const [window, setWindow] = useState(String(policy.mergeWindowSeconds));
  const [conflicted, setConflicted] = useState(false); const [error, setError] = useState(false); const [busy, setBusy] = useState(false);
  const seconds = Number(window);
  const valid = window.trim() !== "" && Number.isInteger(seconds) && seconds >= 0 && seconds <= 300;
  const dirty = level !== baseline.policy.minimumSeverity || seconds !== baseline.policy.mergeWindowSeconds;
  function adopt(value: { policy: Policy; policyVersion: number }) {
    setBaseline(value); setLevel(value.policy.minimumSeverity); setWindow(String(value.policy.mergeWindowSeconds)); setConflicted(false); setError(false);
  }
  // Polls may refresh clean forms, but never discard an unsaved or conflicted draft.
  useEffect(() => { if (!dirty && !conflicted && !busy && policyVersion > baseline.policyVersion) adopt({ policy, policyVersion }); }, [policy.minimumSeverity, policy.mergeWindowSeconds, policyVersion, dirty, conflicted, busy]);
  useEffect(() => { adopt({ policy, policyVersion }); }, [scope]);
  async function save() {
    if (busy || pending || conflicted || !valid || !dirty) return;
    setBusy(true); setError(false);
    try { await onSave({ minimumSeverity: level, mergeWindowSeconds: seconds, expectedVersion: baseline.policyVersion }); adopt({ policy: { minimumSeverity: level, mergeWindowSeconds: seconds }, policyVersion: baseline.policyVersion + 1 }); }
    catch (failure) { setError(true); if ((failure as { status?: number })?.status === 409) setConflicted(true); }
    finally { setBusy(false); }
  }
  return <div className="space-y-2">
    <p className="text-sm text-muted-foreground">{labels.help}</p>
    {error && <p role="alert">{conflicted ? labels.conflict : labels.error}</p>}
    {conflicted && <Button type="button" variant="outline" disabled={pending || busy} onClick={async () => {
      setBusy(true); try { adopt(await onReload()); } catch { setError(true); } finally { setBusy(false); }
    }}>{labels.reload}</Button>}
    <label className="block text-sm">{labels.severity}
      <NativeSelect aria-label={labels.severity} value={level} disabled={pending || busy} onChange={event => setLevel(event.target.value as Policy["minimumSeverity"])}>
        {(["info", "warning", "critical"] as const).map(value => <option key={value} value={value}>{labels[value]}</option>)}
      </NativeSelect>
    </label>
    <label className="block text-sm">{labels.window}
      <Input aria-label={labels.window} type="number" min={0} max={300} step={1} value={window} disabled={pending || busy} onChange={event => setWindow(event.target.value)} aria-invalid={!valid} />
    </label>
    <div className="flex items-center justify-between gap-2">
      <Button type="button" variant="ghost" disabled={pending || busy || !dirty || conflicted} onClick={() => adopt(baseline)}>{labels.cancel}</Button>
      <Button type="button" disabled={pending || busy || conflicted || !valid || !dirty} onClick={() => void save()}>{labels.save}</Button>
    </div>
  </div>;
}
