import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { researchRoutineReportContract } from "@paperclipai/shared/mimouse-research-routines";
import { routinesApi } from "@/api/routines";
import { api } from "@/api/client";
import { useTranslation } from "@/i18n";
import { Link } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
type Binding = { routineId: string; product: string; enabled: boolean; routine: { title: string; status: string }; contract: ReturnType<typeof researchRoutineReportContract> };
export function ResearchRoutinePanel({ companyId, userId }: { companyId: string; userId: string }) {
  const { t } = useTranslation();
  const statusLabel = (status: string) => t(status === "archived" ? "propertyLabels.archived" : `statuses.${status}`, { defaultValue: status });
  const client = useQueryClient(), key = ["research-routines", companyId, userId], root = `/companies/${companyId}/research-routines`;
  const [routineId, setRoutineId] = useState(""), [product, setProduct] = useState(""), [enabled, setEnabled] = useState(false);
  const bindings = useQuery({ queryKey: key, queryFn: () => api.get<Binding[]>(root), retry: false });
  const routines = useQuery({ queryKey: [...key, "available"], queryFn: () => api.get<Array<{ id: string; title: string; status: string }>>(root + "/available"), retry: false });
  const save = useMutation({ mutationFn: () => api.put(root + "/" + encodeURIComponent(routineId), { product, enabled }),
    onSuccess: () => { void client.invalidateQueries({ queryKey: key }); } });
  const create = useMutation({ mutationFn: async () => {
    // Reuse the standard creation endpoint and permission/assignment checks.
    // No run or trigger endpoint is ever called by this component.
    const contract = researchRoutineReportContract(companyId, "<task.originId>", product);
    const routine = await routinesApi.create(companyId, { title: `${t("researchRoutineUi.title")}: ${product}`.slice(0, 200), status: "paused",
      description: `${contract.instructions}\n\nRead your current task via the existing issue API. Use its originId as routineId and originRunId as routineRunId, and its id as issueId.\n${JSON.stringify(contract, null, 2)}` });
    setRoutineId(routine.id);
    await api.put(root + "/" + routine.id, { product, enabled: false });
    return routine;
  }, onSettled: () => { void client.invalidateQueries({ queryKey: key }); } });
  if (bindings.isPending || routines.isPending) return null;
  if (bindings.isError || routines.isError) return <p role="alert">{t("researchRoutineUi.loadError")}</p>;
  return <section className="space-y-3 rounded-lg border border-border p-4">
    <h2 className="font-medium">{t("researchRoutineUi.title")}</h2><p className="text-sm text-muted-foreground">{t("researchRoutineUi.boundary")}</p>
    <form className="space-y-3" onSubmit={event => { event.preventDefault(); if (routineId && product.trim() && !save.isPending && !create.isPending) save.mutate(); }}>
      <fieldset disabled={save.isPending || create.isPending} className="space-y-3">
        <label className="block space-y-1"><span>{t("researchRoutineUi.product")}</span><Input required maxLength={120} value={product} onChange={event => setProduct(event.target.value)} /></label>
        <label className="block space-y-1"><span>{t("researchRoutineUi.routine")}</span><select className="w-full rounded-md border border-border bg-background p-2" value={routineId} onChange={event => { setRoutineId(event.target.value); const binding = bindings.data.find(item => item.routineId === event.target.value); setEnabled(binding?.enabled ?? false); if (binding) setProduct(binding.product); }}><option value="">—</option>{routines.data.map(routine => <option key={routine.id} value={routine.id}>{routine.title} · {statusLabel(routine.status)}</option>)}</select></label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} />{t("researchRoutineUi.enabled")}</label>
        <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={!product.trim()} onClick={() => { if (!create.isPending && !save.isPending) create.mutate(); }}>{t("researchRoutineUi.create")}</Button><Button disabled={!routineId || !product.trim()}>{t("researchRoutineUi.bind")}</Button></div>
      </fieldset>
    </form>
    {(save.isError || create.isError) && <p role="alert">{t("researchRoutineUi.error")}</p>}
    {bindings.data.map(binding => <div key={binding.routineId} className="space-y-2 rounded border border-border p-3">
      <p>{binding.routine.title} · {binding.product} · {statusLabel(binding.routine.status)} · {t(binding.enabled ? "researchRoutineUi.accepting" : "researchRoutineUi.notAccepting")}</p>
      <Link className="underline" to={`/routines/${binding.routineId}`}>{t("researchRoutineUi.configure")}</Link>
      <details><summary>{t("researchRoutineUi.contract")}</summary><pre className="whitespace-pre-wrap break-words text-xs">{JSON.stringify(binding.contract, null, 2)}</pre></details>
    </div>)}
  </section>;
}
