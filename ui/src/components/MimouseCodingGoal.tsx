import { useEffect, useRef, useState } from "react";
import { codingGoalReceiptSchema, codingGoalSchema, type CodingGoal, type CodingGoalReceipt } from "@paperclipai/shared";
import { api, ApiError } from "@/api/client";
import { readCodingEvidence } from "@/api/coding-read";
import { useTranslation } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Props = { companyId: string; issueId: string; userId: string; sessionId: string; authEpoch: number };
const listFields = ["acceptanceScenarios", "testCommands", "artifactRequirements", "humanReviewActions"] as const;
type Draft = { problemValue: string; acceptanceScenarios: string; testCommands: string; artifactRequirements: string; humanReviewActions: string; baseSha: string; maxCostCents: string; maxRepairRounds: string; allowedRepositories: { repoUrl: string; paths: string }[] };
const emptyDraft = (): Draft => ({ problemValue: "", acceptanceScenarios: "", testCommands: "", artifactRequirements: "", humanReviewActions: "", baseSha: "", maxCostCents: "", maxRepairRounds: "2", allowedRepositories: [{ repoUrl: "", paths: "" }] });
const lines = (value: string) => value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
function draftFor(goal: CodingGoal | null): Draft {
  if (!goal) return emptyDraft();
  return { ...goal,
    acceptanceScenarios: goal.acceptanceScenarios.join("\n"), testCommands: goal.testCommands.join("\n"), artifactRequirements: goal.artifactRequirements.join("\n"), humanReviewActions: goal.humanReviewActions.join("\n"),
    maxCostCents: String(goal.budget.maxCostCents), maxRepairRounds: String(goal.maxRepairRounds),
    allowedRepositories: goal.allowedRepositories.map(repo => ({ repoUrl: repo.repoUrl, paths: repo.paths.join("\n") })) };
}
function goalFor(draft: Draft) {
  return codingGoalSchema.safeParse({ schemaVersion: 1, problemValue: draft.problemValue, baseSha: draft.baseSha,
    ...Object.fromEntries(listFields.map(field => [field, lines(draft[field])])),
    budget: { maxCostCents: draft.maxCostCents.trim() ? Number(draft.maxCostCents) : NaN }, maxRepairRounds: draft.maxRepairRounds.trim() ? Number(draft.maxRepairRounds) : NaN,
    allowedRepositories: draft.allowedRepositories.map(repo => ({ repoUrl: repo.repoUrl, paths: lines(repo.paths) })) });
}
export function MimouseCodingGoal(props: Props) {
  return <GoalEditor {...props} key={[props.companyId, props.issueId, props.userId, props.sessionId, props.authEpoch].join(":")} />;
}
function GoalEditor({ companyId, issueId }: Props) {
  const { t } = useTranslation(); const text = (key: string) => t(`codingGoal.${key}`);
  const [open, setOpen] = useState(false); const [draft, setDraft] = useState(emptyDraft);
  const [receipt, setReceipt] = useState<CodingGoalReceipt | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "saving" | "saved" | "error" | "unknown" | "denied">("idle");
  const alive = useRef(true); const busy = useRef(false); const abort = useRef<AbortController | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; abort.current?.abort(); }; }, []);
  const validIssue = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(issueId);
  const path = `/companies/${companyId}/coding/tasks/${issueId}/goal`;
  const parsed = goalFor(draft); const editable = ["ready", "saved"].includes(status);
  const accept = (value: unknown) => {
    const result = codingGoalReceiptSchema.parse(value);
    if (result.issueId !== issueId || Boolean(result.goal) !== Boolean(result.revisionId)) throw Error("invalid_goal_receipt");
    return result;
  };
  async function load() {
    if (busy.current || !validIssue) return;
    busy.current = true; setStatus("loading"); setReceipt(null); setDraft(emptyDraft());
    const controller = new AbortController(); abort.current = controller;
    try {
      const value = accept(await readCodingEvidence(path, controller.signal));
      if (alive.current) { setReceipt(value); setDraft(draftFor(value.goal)); setStatus("ready"); }
    } catch (error) {
      if (alive.current) setStatus(error instanceof ApiError && [401, 403, 404].includes(error.status) ? "denied" : "error");
    } finally { busy.current = false; }
  }
  async function save() {
    if (busy.current || !editable || !parsed.success || !receipt) return;
    busy.current = true; setStatus("saving");
    try {
      const value = accept(await api.put(path, { goal: parsed.data, baseRevisionId: receipt.revisionId }));
      if (JSON.stringify(value.goal) !== JSON.stringify(parsed.data)) throw Error("mismatched_goal_receipt");
      if (alive.current) { setReceipt(value); setDraft(draftFor(value.goal)); setStatus("saved"); }
    } catch (error) {
      if (alive.current) {
        const denied = error instanceof ApiError && [401, 403, 404].includes(error.status);
        if (denied) { setDraft(emptyDraft()); setReceipt(null); }
        setStatus(denied ? "denied" : "unknown");
      }
    } finally { busy.current = false; }
  }
  return <section className="rounded-lg border border-border p-4 space-y-3">
    <Button type="button" variant="outline" disabled={!validIssue || status === "saving" || status === "loading"} onClick={() => { if (open) { setOpen(false); setDraft(emptyDraft()); setReceipt(null); setStatus("idle"); } else { setOpen(true); void load(); } }}>{text(open ? "close" : "title")}</Button>
    {!validIssue && <p className="text-sm text-muted-foreground">{text("selectTask")}</p>}
    {open && <>
      <p className="text-sm text-muted-foreground">{text("boundary")}</p>
      {["loading", "saving", "saved", "error", "unknown", "denied"].includes(status) && <p role={status === "error" || status === "unknown" || status === "denied" ? "alert" : "status"}>{text(status)}</p>}
      {receipt?.revisionId && <p className="font-mono text-xs break-all">{text("revision")}: {receipt.revisionId}</p>}
      {status !== "denied" && <form onSubmit={event => { event.preventDefault(); void save(); }} className="space-y-3">
        <fieldset disabled={!editable} className="space-y-3">
          <label className="block space-y-1"><span>{text("problemValue")}</span><textarea aria-label={text("problemValue")} className="w-full rounded-md border border-border bg-background p-3 text-sm" value={draft.problemValue} onChange={event => setDraft({ ...draft, problemValue: event.target.value })} /></label>
          {listFields.map(field => <label key={field} className="block space-y-1"><span>{text(field)}</span><textarea aria-label={text(field)} className="w-full rounded-md border border-border bg-background p-3 text-sm" value={draft[field]} onChange={event => setDraft({ ...draft, [field]: event.target.value })} /></label>)}
          <p className="text-sm text-muted-foreground">{text("listHint")}</p>
          <h3 className="font-medium">{text("allowedRepositories")}</h3>
          {draft.allowedRepositories.map((repo, index) => <div key={index} className="space-y-2">
            <label className="block space-y-1"><span>{text("repoUrl")} {index + 1}</span><Input aria-label={`${text("repoUrl")} ${index + 1}`} value={repo.repoUrl} onChange={event => setDraft({ ...draft, allowedRepositories: draft.allowedRepositories.map((item, i) => i === index ? { ...item, repoUrl: event.target.value } : item) })} /></label>
            <label className="block space-y-1"><span>{text("paths")} {index + 1}</span><textarea aria-label={`${text("paths")} ${index + 1}`} className="w-full rounded-md border border-border bg-background p-3 text-sm" value={repo.paths} onChange={event => setDraft({ ...draft, allowedRepositories: draft.allowedRepositories.map((item, i) => i === index ? { ...item, paths: event.target.value } : item) })} /></label>
            {draft.allowedRepositories.length > 1 && <Button type="button" variant="outline" onClick={() => setDraft({ ...draft, allowedRepositories: draft.allowedRepositories.filter((_, i) => i !== index) })}>{text("removeRepo")}</Button>}
          </div>)}
          <Button type="button" variant="outline" disabled={draft.allowedRepositories.length >= 10} onClick={() => setDraft({ ...draft, allowedRepositories: [...draft.allowedRepositories, { repoUrl: "", paths: "" }] })}>{text("addRepo")}</Button>
          {(["baseSha", "maxCostCents", "maxRepairRounds"] as const).map(field => <label key={field} className="block space-y-1"><span>{text(field)}</span><Input aria-label={text(field)} type={field === "baseSha" ? "text" : "number"} value={draft[field]} onChange={event => setDraft({ ...draft, [field]: event.target.value })} /></label>)}
        </fieldset>
        {editable && !parsed.success && <p className="text-sm text-muted-foreground">{text("invalid")}</p>}
        <div className="flex items-center justify-between gap-2"><Button type="button" variant="outline" disabled={status === "saving" || status === "loading"} onClick={() => void load()}>{text("reload")}</Button><Button type="submit" disabled={!editable || !parsed.success}>{text("save")}</Button></div>
      </form>}
    </>}
  </section>;
}
