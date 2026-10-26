import { useEffect, useState } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

type Policy = { minimumSeverity: "info" | "warning" | "critical"; mergeWindowSeconds: number };
/** Parent owns authenticated mutation/error display. Scope prevents company-switch draft leakage. */
export function MimouseNotificationPolicy({ scope, policy, pending, onSave, labels }: {
  scope: string;
  policy: Policy;
  pending: boolean;
  onSave: (policy: Policy) => void;
  labels: { severity: string; info: string; warning: string; critical: string; window: string; help: string; save: string; cancel: string };
}) {
  const [level, setLevel] = useState(policy.minimumSeverity);
  const [window, setWindow] = useState(String(policy.mergeWindowSeconds));
  useEffect(() => { setLevel(policy.minimumSeverity); setWindow(String(policy.mergeWindowSeconds)); }, [scope, policy.minimumSeverity, policy.mergeWindowSeconds]);
  const seconds = Number(window);
  const valid = window.trim() !== "" && Number.isInteger(seconds) && seconds >= 0 && seconds <= 300;
  const dirty = level !== policy.minimumSeverity || seconds !== policy.mergeWindowSeconds;
  return <div className="space-y-2">
    <p className="text-sm text-muted-foreground">{labels.help}</p>
    <label className="block text-sm">{labels.severity}
      <Select value={level} disabled={pending} onValueChange={value => setLevel(value as Policy["minimumSeverity"])}>
        <SelectTrigger aria-label={labels.severity}><SelectValue /></SelectTrigger>
        <SelectContent>{(["info", "warning", "critical"] as const).map(value => <SelectItem key={value} value={value}>{labels[value]}</SelectItem>)}</SelectContent>
      </Select>
    </label>
    <label className="block text-sm">{labels.window}
      <Input aria-label={labels.window} type="number" min={0} max={300} step={1} value={window} disabled={pending} onChange={event => setWindow(event.target.value)} aria-invalid={!valid} />
    </label>
    <div className="flex items-center justify-between gap-2">
      <Button variant="ghost" disabled={pending || !dirty} onClick={() => { setLevel(policy.minimumSeverity); setWindow(String(policy.mergeWindowSeconds)); }}>{labels.cancel}</Button>
      <Button disabled={pending || !valid || !dirty} onClick={() => onSave({ minimumSeverity: level, mergeWindowSeconds: seconds })}>{labels.save}</Button>
    </div>
  </div>;
}
