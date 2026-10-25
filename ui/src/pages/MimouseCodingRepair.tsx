import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { routinesApi } from "@/api/routines";
import { useTranslation } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
interface RepairData {
  operatorEnabled: boolean; status: string; lastCode: string | null;
  policy: { enabled: boolean; routineId: string; routineRevisionId: string; expiresAt: string } | null;
  attempts: Array<{ id: string; attempt: number; state: string; issueId: string | null; lastCode: string | null }>;
}
export function MimouseCodingRepair({ companyId, userId, issueId, deliveryId, headSha }: { companyId: string; userId: string; issueId: string; deliveryId: string; headSha: string }) {
  const { t } = useTranslation(); const client = useQueryClient(); const [open, setOpen] = useState(false);
  const [routineId, setRoutineId] = useState(""); const [maxAttempts, setMaxAttempts] = useState("2"); const [minutes, setMinutes] = useState("15"); const [cents, setCents] = useState("100"); const [confirmedFor, setConfirmedFor] = useState<string | null>(null);
  const root = `/companies/${companyId}/coding/${deliveryId}`; const key = ["coding-repairs", companyId, userId, deliveryId];
  const query = useQuery({ queryKey: key, queryFn: () => api.get<RepairData>(`${root}/repairs`), enabled: open });
  const routineQuery = useQuery({ queryKey: ["coding-repair-routines", companyId, userId, issueId], queryFn: () => routinesApi.list(companyId), enabled: open && query.data?.operatorEnabled === true });
  const candidates = (routineQuery.data ?? []).filter(routine => routine.parentIssueId === issueId && routine.status === "active" && routine.concurrencyPolicy === "always_enqueue");
  const selected = candidates.find(routine => routine.id === routineId);
  const scope = JSON.stringify([companyId, userId, deliveryId, headSha, routineId, selected?.latestRevisionId, maxAttempts, minutes, cents]);
  const fields = [{ key: "maxAttempts", value: maxAttempts, set: setMaxAttempts, max: 2 }, { key: "minutes", value: minutes, set: setMinutes, max: 60 }, { key: "cents", value: cents, set: setCents, max: 1000000 }];
  const mutation = useMutation({ mutationFn: (enabled: boolean) => api.post(`${root}/repair-settings`, enabled
    ? { enabled: true, confirm: true, headSha, routineId, expectedRoutineRevisionId: selected?.latestRevisionId, maxAttempts: Number(maxAttempts), maxDurationMinutes: Number(minutes), maxCostCents: Number(cents) }
    : { enabled: false, confirm: true, headSha }), onSuccess: async () => { setConfirmedFor(null); await client.invalidateQueries({ queryKey: key }); } });
  const integer = (value: string, max: number) => Number.isSafeInteger(Number(value)) && Number(value) >= 1 && Number(value) <= max;
  const canEnable = query.data?.operatorEnabled === true && !query.isError && !routineQuery.isError && candidates.some(routine => routine.id === routineId) && userId !== "local-board" && confirmedFor === scope && Boolean(selected?.latestRevisionId) && integer(maxAttempts, 2) && integer(minutes, 60) && integer(cents, 1000000);
  return <div className="space-y-3">
    <Button variant="outline" onClick={() => { setOpen(!open); setConfirmedFor(null); }}>{t("codingRepair.manage")}</Button>
    {open && <div className="rounded-md border border-border p-3 space-y-3">
      <h3 className="font-medium">{t("codingRepair.title")}</h3><p className="text-sm">{t("codingRepair.boundary")}</p>
      {query.isPending && <p>{t("common.loading")}</p>}
      {(query.isError || routineQuery.isError || mutation.isError) && <p role="alert">{t("codingRepair.error")}</p>}
      {!query.isError && query.data && <>
        {!query.data.operatorEnabled && <p>{t("codingRepair.disabled")}</p>}
        {userId === "local-board" && <p>{t("codingRepair.loginRequired")}</p>}
        <p>{t("codingRepair.status")}: {t(`codingRepair.state_${query.data.status}`, { defaultValue: query.data.status })}</p>
        {query.data.lastCode && <p className="text-sm">{t("codingRepair.diagnostic")}: {query.data.lastCode}</p>}
        {query.data.policy && <p className="font-mono text-sm break-all">{t("codingRepair.pinnedRevision")}: {query.data.policy.routineRevisionId}</p>}
        <label className="block space-y-1"><span>{t("codingRepair.routine")}</span><select className="w-full rounded-md border border-border bg-background p-2" value={routineId} onChange={event => { setRoutineId(event.target.value); setConfirmedFor(null); }}>
          <option value="">{t("codingRepair.chooseRoutine")}</option>{candidates.map(routine => <option key={routine.id} value={routine.id}>{routine.title}</option>)}
        </select></label>
        {selected?.latestRevisionId && <p className="font-mono text-sm break-all">{t("codingRepair.pinnedRevision")}: {selected.latestRevisionId}</p>}
        <p className="text-sm text-muted-foreground">{t("codingRepair.routineHelp")}</p>
        <div className="grid gap-3 sm:grid-cols-3">
          {fields.map(field => <label key={field.key} className="block space-y-1"><span>{t(`codingRepair.${field.key}`)}</span><Input type="number" min={1} max={field.max} step={1} value={field.value} onChange={event => { field.set(event.target.value); setConfirmedFor(null); }} /></label>)}
        </div>
        <p className="text-sm text-muted-foreground">{t("codingRepair.limitHelp")}</p>
        <label className="flex gap-2 items-start"><input type="checkbox" checked={confirmedFor === scope} onChange={event => setConfirmedFor(event.target.checked ? scope : null)} /><span>{t("codingRepair.confirm")}</span></label>
        <div className="flex flex-wrap gap-2"><Button disabled={!canEnable || mutation.isPending} onClick={() => mutation.mutate(true)}>{t("codingRepair.enable")}</Button>
          <Button variant="outline" disabled={!query.data.policy?.enabled || mutation.isPending || userId === "local-board"} onClick={() => mutation.mutate(false)}>{t("codingRepair.pause")}</Button>
          <Button variant="outline" disabled={query.isFetching} onClick={() => { void query.refetch(); }}>{t("codingRepair.refresh")}</Button></div>
        <p className="text-sm">{t("codingRepair.noCancel")}</p>
        <h4>{t("codingRepair.history")}</h4>
        {query.data.attempts.length === 0 && <p>{t("codingRepair.empty")}</p>}
        {query.data.attempts.map(attempt => <div key={attempt.id} className="text-sm space-y-1"><p>{t("codingRepair.attempt", { number: attempt.attempt })}: {t(`codingRepair.state_${attempt.state}`, { defaultValue: attempt.state })}</p>
          {attempt.issueId && <p className="font-mono break-all">{t("codingRepair.taskId")}: {attempt.issueId}</p>}{attempt.lastCode && <p>{t("codingRepair.diagnostic")}: {attempt.lastCode}</p>}</div>)}
      </>}
    </div>}
  </div>;
}
