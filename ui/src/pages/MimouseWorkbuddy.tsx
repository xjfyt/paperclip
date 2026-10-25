import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCompany } from "@/context/CompanyContext";
import { useTranslation } from "@/i18n";
import { api } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
interface WorkbuddyData { enabled: boolean; connections: Array<{ id: string; status: string }>; jobs: Array<{ id: string; providerJobId: string | null; dispatchState: string; remoteState: string; report: string; lastCode: string | null; activeTurn: string | null }> }
export function MimouseWorkbuddy() {
  const { selectedCompanyId } = useCompany();
  if (!selectedCompanyId) return null;
  return <WorkbuddyCompany key={selectedCompanyId} companyId={selectedCompanyId} />;
}
function WorkbuddyCompany({ companyId }: { companyId: string }) {
  const { t } = useTranslation(); const client = useQueryClient();
  const root = `/companies/${companyId}/integrations/workbuddy`; const key = ["workbuddy", companyId];
  const query = useQuery({ queryKey: key, queryFn: () => api.get<WorkbuddyData>(root) });
  const [prompt, setPrompt] = useState(""); const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const [confirm, setConfirm] = useState(false);
  const mutation = useMutation({ mutationFn: (action: () => Promise<unknown>) => action(), onSuccess: async () => { await client.invalidateQueries({ queryKey: key }); setConfirm(false); } });
  const account = query.data?.connections.find(connection => connection.status === "connected");
  return <div className="space-y-4 max-w-4xl">
    <h1 className="text-xl font-semibold">WorkBuddy</h1>
    <p>{t("workbuddy.boundary")}</p>
    {!query.data?.enabled && <p>{t("workbuddy.disabled")}</p>}
    {(query.error || mutation.error) && <p role="alert">{t("workbuddy.error")}</p>}
    <Button disabled={!query.data?.enabled || mutation.isPending} onClick={() => mutation.mutate(async () => {
      const result = await api.post<{ url: string }>(`${root}/authorize`, {});
      const url = new URL(result.url); if (url.origin !== "https://www.workbuddy.cn") throw Error("Unexpected authorization origin"); window.location.assign(url.href);
    })}>{t("workbuddy.connect")}</Button>
    {query.data?.connections.map(connection => <div key={connection.id} className="flex gap-3 items-center">
      <span>{t(`workbuddy.state_${connection.status}`, { defaultValue: connection.status })}</span>
      <Button variant="outline" disabled={mutation.isPending} onClick={() => mutation.mutate(() => api.post(`${root}/connections/${connection.id}/disconnect`, {}))}>{t("workbuddy.disconnect")}</Button>
    </div>)}
    <section className="rounded-lg border border-border p-4 space-y-3">
      <h2 className="font-medium">{t("workbuddy.newTask")}</h2>
      <label htmlFor="workbuddy-prompt">{t("workbuddy.prompt")}</label><Input id="workbuddy-prompt" value={prompt} onChange={event => { setPrompt(event.target.value); setRequestKey(crypto.randomUUID()); setConfirm(false); }} />
      <p className="text-sm text-muted-foreground">{t("workbuddy.warning")}</p>
      <label className="flex items-center gap-2"><input type="checkbox" checked={confirm} onChange={event => setConfirm(event.target.checked)} />{t("workbuddy.confirm")}</label>
      <Button disabled={!query.data?.enabled || !account || !prompt.trim() || !confirm || mutation.isPending} onClick={() => mutation.mutate(() => api.post(`${root}/jobs`, { connectionId: account!.id, requestKey, prompt, confirmRemoteExecution: true }))}>{t("workbuddy.create")}</Button>
    </section>
    {query.data?.jobs.map(job => <section key={job.id} className="rounded-lg border border-border p-4 space-y-2">
      <p className="font-mono text-sm">{job.providerJobId ?? job.id}</p>
      <p>{t(`workbuddy.state_${job.dispatchState}`, { defaultValue: job.dispatchState })} · {t(`workbuddy.state_${job.remoteState}`, { defaultValue: job.remoteState })}</p>
      <Button variant="outline" disabled={mutation.isPending} onClick={() => mutation.mutate(() => api.post(`${root}/jobs/${job.id}/refresh`, {}))}>{t("workbuddy.refresh")}</Button>
      {job.lastCode && <p role="status" className="text-sm text-muted-foreground">{t("shell.lastIssue")}: {job.lastCode}</p>}
      {job.report && <pre className="whitespace-pre-wrap text-sm">{job.report}</pre>}
      <p className="text-sm text-muted-foreground">{t("workbuddy.roundBoundary")}</p>
    </section>)}
  </div>;
}
