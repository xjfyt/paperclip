import { useEffect, useRef, useState } from "react";
import { comparePrivatePromptTestsSchema, type PrivatePromptComparison as Comparison } from "@paperclipai/shared/mimouse-private-prompt-comparison";
import { ApiError } from "@/api/client";
import { privatePromptComparisonApi, verifyPrivatePromptComparison } from "@/api/private-prompt-comparison";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatNumber, useTranslation } from "@/i18n";

type Props = { companyId: string; userId: string; sessionId: string; promptId: string | null; authPending?: boolean; onAccessLost: () => void };
const fields = ["datasetId", "baselineRevisionId", "candidateRevisionId"] as const;
const empty = { datasetId: "", baselineRevisionId: "", candidateRevisionId: "", testIds: "", maxCandidateCostCents: "" };
/** Every identity, prompt and authorization transition destroys private local state. */
export function PrivatePromptComparison(props: Props) {
  if (!props.companyId || !props.userId || !props.sessionId || !props.promptId || props.authPending) return null;
  return <ComparisonSession key={JSON.stringify([props.companyId, props.userId, props.sessionId, props.promptId])} {...props} promptId={props.promptId} />;
}
function ComparisonSession(props: Props & { promptId: string }) {
  const { t } = useTranslation(), label = (key: string) => t(`privatePromptComparisonUi.${key}`);
  const [draft, setDraft] = useState(empty), [result, setResult] = useState<Comparison | null>(null), [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const generation = useRef(0), controller = useRef<AbortController | null>(null), live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; generation.current++; controller.current?.abort(); }; }, []);
  function clearResult() { generation.current++; controller.current?.abort(); controller.current = null; setResult(null); setBusy(false); setNotice(""); }
  function edit(key: keyof typeof empty, value: string) { clearResult(); setDraft(old => ({ ...old, [key]: value })); }
  const parsed = comparePrivatePromptTestsSchema.safeParse({ ...draft,
    testIds: draft.testIds.trim() ? draft.testIds.trim().split(/[\s,]+/) : [],
    maxCandidateCostCents: draft.maxCandidateCostCents.trim() === "" ? null : Number(draft.maxCandidateCostCents),
  });
  async function compare() {
    if (!parsed.success || busy || controller.current) return;
    clearResult(); const epoch = ++generation.current, abort = new AbortController(); controller.current = abort; setBusy(true);
    const current = () => live.current && generation.current === epoch && !abort.signal.aborted;
    try {
      const response = await privatePromptComparisonApi(props.companyId, props.userId, abort.signal).compare(props.promptId, parsed.data);
      if (!current()) return;
      setResult(verifyPrivatePromptComparison(response, props.companyId, props.userId, props.promptId, parsed.data));
    } catch (error) {
      if (!current()) return;
      setResult(null); setNotice("failed");
      if (error instanceof ApiError && [401, 403].includes(error.status)) { setDraft(empty); props.onAccessLost(); }
    } finally { if (current()) { setBusy(false); controller.current = null; } }
  }
  const cost = (value: number | null) => value === null ? label("unknown") : formatNumber(value, { maximumFractionDigits: 7 });
  return <section className="space-y-3" aria-label={label("title")}>
    <h2 className="text-lg font-semibold">{label("title")}</h2>
    <p>{label("boundary")}</p><p className="text-sm text-muted-foreground">{label("evidence")}</p>
    <div className="space-y-2">
      {fields.map(key => <label key={key} className="block">{label(key)}<Input aria-label={label(key)} className="font-mono" autoComplete="off" maxLength={36} value={draft[key]} onChange={event => edit(key, event.target.value)} /></label>)}
      <label className="block">{label("testIds")}<Textarea aria-label={label("testIds")} className="font-mono" autoComplete="off" maxLength={74000} value={draft.testIds} onChange={event => edit("testIds", event.target.value)} /></label>
      <p className="text-sm text-muted-foreground">{label("testHelp")}</p>
      <label className="block">{label("maxCandidateCostCents")}<Input aria-label={label("maxCandidateCostCents")} className="font-mono" inputMode="numeric" autoComplete="off" value={draft.maxCandidateCostCents} onChange={event => edit("maxCandidateCostCents", event.target.value)} /></label>
      <div className="flex items-center justify-between gap-2"><Button variant="outline" onClick={() => { clearResult(); setDraft(empty); }}>{label("clear")}</Button><Button disabled={!parsed.success || busy} onClick={() => void compare()}>{label("compare")}</Button></div>
    </div>
    {busy && <p role="status">{label("loading")}</p>}{notice && <p role="alert">{label(notice)}</p>}
    {result && <div className="space-y-2" aria-label={label("result")}>
      <p role="status">{label(result.eligibleForHumanReview ? "reviewable" : "blocked")}</p>
      <p className="text-sm text-muted-foreground">{label("costBoundary")}</p>
      {["baseline", "candidate"].map(side => { const summary = side === "baseline" ? result.baseline : result.candidate; return <div key={side} className="space-y-1">
        <h3 className="font-medium">{label(side)}</h3><p className="font-mono break-all">{summary.revisionId}</p>
        <p>{label("quality")}: <span className="font-mono">{formatNumber(summary.passed)} / {formatNumber(summary.cases)}</span> · {label("blockedCases")}: <span className="font-mono">{formatNumber(summary.blocked)}</span></p>
        <p>{label("totalCost")}: <span className="font-mono">{cost(summary.totalCostCents)}</span> · {label("knownCost")}: <span className="font-mono">{cost(summary.knownCostCents)}</span> · {label("unknownCases")}: <span className="font-mono">{formatNumber(summary.unknownCostCases)}</span></p>
      </div>; })}
      <ul>{result.blockers.map(code => <li key={code} className="font-mono break-all">{code}</li>)}</ul>
      <details><summary>{label("caseEvidence")}</summary><ul>{result.results.map(row => <li key={`${row.revisionId}:${row.caseId}`} className="break-all"><span className="font-mono">{row.caseId} · {row.revisionId} · {row.testId ?? label("missing")}</span>: {row.blocked ? <span className="font-mono">{row.blocked}</span> : label(row.passed ? "matched" : "mismatched")}</li>)}</ul></details>
      <details><summary>{label("hashes")}</summary><dl className="font-mono break-all">{[result.datasetHash, result.skillVersionHash, result.contextHash, result.baseline.revisionHash, result.candidate.revisionHash, result.reportHash].map((hash, index) => <div key={index}><dt>{label(["datasetHash", "skillHash", "contextHash", "baselineHash", "candidateHash", "reportHash"][index]!)}</dt><dd>{hash}</dd></div>)}</dl></details>
    </div>}
  </section>;
}
