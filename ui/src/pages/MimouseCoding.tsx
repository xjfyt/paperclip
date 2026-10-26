import { MimouseCodingDiffReview } from "@/components/MimouseCodingDiffReview";
import type { MimouseBuildMatrix as BuildMatrix } from "@paperclipai/shared";
import { MimouseBuildMatrix } from "@/components/MimouseBuildMatrix";
import { useEffect as usePageEffect } from "react";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { authApi } from "@/api/auth";
import { queryKeys } from "@/lib/queryKeys";
import { MimouseCodingRepair } from "./MimouseCodingRepair";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "@/lib/router";
import { useCompany } from "@/context/CompanyContext";
import { useTranslation } from "@/i18n";
import { api } from "@/api/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
interface Delivery { buildMatrix?: BuildMatrix; id: string; issueId: string; headSha: string; operationState: string; mrIid: number | null; pipelineId: number | null; gate: { readyForReleaseCandidate: boolean; blockers: string[] } }
export function MimouseCoding() {
  const { t: pageT, i18n: pageI18n } = useTranslation();
  const { setBreadcrumbs } = useBreadcrumbs();
  usePageEffect(() => { setBreadcrumbs([{ label: pageT("coding.title") }]); }, [setBreadcrumbs, pageI18n.language, pageT]);
  const { selectedCompanyId } = useCompany(); const { t } = useTranslation();
  const session = useQuery({ queryKey: queryKeys.auth.session, queryFn: () => authApi.getSession(), retry: false });
  if (!selectedCompanyId) return null;
  if (session.isPending) return <p>{t("common.loading")}</p>;
  if (session.isError) return <p role="alert">{t("coding.error")}</p>;
  const userId = session.data?.user?.id ?? session.data?.session?.userId ?? "local-board";
  return <CodingCompany companyId={selectedCompanyId} userId={userId} key={`${selectedCompanyId}:${userId}`} />;
}
function CodingCompany({ companyId, userId }: { companyId: string; userId: string }) {
  const { t } = useTranslation(); const [search] = useSearchParams(); const client = useQueryClient(); const root = `/companies/${companyId}/coding`; const key = ["mimouse-coding", companyId, userId];
  const query = useQuery({ queryKey: key, queryFn: () => api.get<{ deliveries: Delivery[]; publishEnabled: boolean }>(root) });
  const [form, setForm] = useState({ issueId: search.get("issueId") ?? "", workspaceId: search.get("workspaceId") ?? "", gitlabOrigin: "", projectId: "", secretRef: "", baseSha: "", headSha: "", targetBranch: "main" });
  const [confirmation, setConfirmation] = useState<{ id: string; headSha: string; action: string } | null>(null);
  const [evidence, setEvidence] = useState("[]");
  const mutation = useMutation({ mutationFn: (action: () => Promise<unknown>) => action(), onSuccess: async () => { await client.invalidateQueries({ queryKey: key }); setConfirmation(null); } });
  if (query.isError) return <p role="alert">{t("coding.error")}</p>;
  return <div className="max-w-4xl space-y-5">
    <h1 className="text-xl font-semibold">{t("coding.title")}</h1><p>{t("coding.boundary")}</p>
    {(query.error || mutation.error) && <p role="alert">{t("coding.error")}</p>}
    <form className="rounded-lg border border-border p-4 space-y-2" onSubmit={event => { event.preventDefault(); mutation.mutate(() => api.post(root, { ...form, projectId: Number(form.projectId) })); }}>
      <h2 className="font-medium">{t("coding.register")}</h2>
      {(Object.keys(form) as Array<keyof typeof form>).map(field => <div key={field} className="space-y-1"><label htmlFor={`coding-${field}`}>{t(`coding.${field}`)}</label><Input id={`coding-${field}`} value={form[field]} onChange={event => setForm({ ...form, [field]: event.target.value })} required /></div>)}
      <p className="text-sm text-muted-foreground">{t("coding.cleanWorkspace")}</p><div className="flex justify-end"><Button disabled={mutation.isPending}>{t("common.save")}</Button></div>
    </form>
    {query.data?.deliveries.filter(row => !form.issueId || row.issueId === form.issueId).map(row => <section key={row.id} className="rounded-lg border border-border p-4 space-y-3">
      <p className="font-mono text-sm break-all">{row.headSha}</p><p>{t("coding.operationState")}: {row.operationState}</p>
      <MimouseCodingDiffReview companyId={companyId} userId={userId} deliveryId={row.id} headSha={row.headSha} onReviewed={() => client.invalidateQueries({ queryKey: key })} />
      <MimouseCodingRepair key={`${row.id}:${row.headSha}`} companyId={companyId} userId={userId} issueId={row.issueId} deliveryId={row.id} headSha={row.headSha} />
      <MimouseBuildMatrix matrix={row.buildMatrix} companyId={companyId} deliveryId={row.id} commitSha={row.headSha} />
      <p className="text-xs text-muted-foreground">{t("buildMatrixUi.codeGate")}</p>
      <p>{row.gate.readyForReleaseCandidate ? t("coding.candidate") : t("coding.notReady")}</p>
      {row.gate.blockers.map(blocker => <p key={blocker} className="text-sm">{t(`coding.${blocker}`, { defaultValue: blocker })}</p>)}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={mutation.isPending} onClick={() => mutation.mutate(() => api.post(`${root}/${row.id}/sync`, {}))}>{t("coding.sync")}</Button>
        {["merge-request", "evidence", ...(query.data!.publishEnabled ? ["publish"] : [])].map(action => <Button key={action} variant="outline" disabled={mutation.isPending} onClick={() => { setConfirmation({ id: row.id, headSha: row.headSha, action }); setEvidence("[]"); }}>{t(`coding.${action}`)}</Button>)}
      </div>
    </section>)}
    {confirmation && <section className="rounded-lg border border-border p-4 space-y-3">
      <h2>{t(`coding.${confirmation.action}`)}</h2><p className="font-mono text-sm break-all">{confirmation.headSha}</p><p>{t("coding.confirmScope")}</p>
      {confirmation.action === "evidence" && <><label htmlFor="coding-evidence">{t("coding.evidenceJson")}</label><textarea id="coding-evidence" className="w-full rounded-md border border-border bg-background p-3 text-sm" value={evidence} onChange={event => setEvidence(event.target.value)} /></>}
      <div className="flex justify-between"><Button variant="outline" onClick={() => setConfirmation(null)}>{t("common.cancel")}</Button><Button disabled={mutation.isPending} onClick={() => mutation.mutate(async () => api.post(`${root}/${confirmation.id}/${confirmation.action}`, confirmation.action === "evidence" ? { headSha: confirmation.headSha, checks: JSON.parse(evidence) } : { headSha: confirmation.headSha, confirm: true }))}>{t("coding.confirm")}</Button></div>
    </section>}
  </div>;
}
