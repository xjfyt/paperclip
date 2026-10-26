import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { authApi } from "@/api/auth";
import { healthApi } from "@/api/health";
import { queryKeys } from "@/lib/queryKeys";
import { useCompany } from "@/context/CompanyContext";
import { useTranslation } from "@/i18n";
import { Button } from "@/components/ui/button";
import { costRoutingPreviewApi as api } from "@/api/cost-routing-preview";
import { routingPolicySchema, type RoutingPolicyRecord, type RoutingPreviewRecord } from "@paperclipai/shared/cost-routing-preview";
export function CostRoutingPreview() {
  const { selectedCompanyId } = useCompany(), { t } = useTranslation();
  const session = useQuery({ queryKey: queryKeys.auth.session, queryFn: authApi.getSession, retry: false });
  const userId = session.data?.user?.id ?? session.data?.session?.userId;
  const health = useQuery({ queryKey: queryKeys.health, queryFn: healthApi.get, enabled: session.isSuccess && !userId });
  if (!selectedCompanyId) return <p>{t("costRoutingPreview.chooseCompany")}</p>;
  if (session.isError) return <p role="alert">{t("costRoutingPreview.error")}</p>;
  if (!session.isSuccess || session.isFetching) return <p role="status">{t("costRoutingPreview.loading")}</p>;
  const identity = userId ? `${userId}:${session.data?.session?.id ?? "session"}`
    : health.isSuccess && !health.isFetching && health.data.deploymentMode === "local_trusted" ? "local-board" : null;
  if (!identity) return <p role="alert">{t("costRoutingPreview.error")}</p>;
  return <CompanyPolicy key={`${selectedCompanyId}:${identity}`} companyId={selectedCompanyId} identity={identity} />;
}
function CompanyPolicy({ companyId, identity }: { companyId: string; identity: string }) {
  const { t } = useTranslation();
  const query = useQuery({ queryKey: ["cost-routing-preview", companyId, identity],
    queryFn: ({ signal }) => api.current(companyId, signal), retry: false, staleTime: 0, gcTime: 0 });
  // Never display a cached admin policy during/after failed authorization refresh.
  if (query.isError) return <p role="alert">{t("costRoutingPreview.error")}</p>;
  if (!query.isSuccess || query.isFetching) return <p role="status">{t("costRoutingPreview.loading")}</p>;
  return <PolicyEditor key={query.dataUpdatedAt} companyId={companyId} initialPolicy={query.data} />;
}
function PolicyEditor({ companyId, initialPolicy }: { companyId: string; initialPolicy: RoutingPolicyRecord | null }) {
  const { t } = useTranslation(), active = useRef(true);
  const [policy, setPolicy] = useState(initialPolicy), [draft, setDraft] = useState(initialPolicy ? JSON.stringify(initialPolicy.policy, null, 2) : "");
  const [result, setResult] = useState<RoutingPreviewRecord | null>(null), [busy, setBusy] = useState(false);
  const [error, setError] = useState(false), [loaded, setLoaded] = useState(true);
  const saveRetry = useRef<{ text: string; revision: number; requestId: string } | null>(null);
  const previewRetry = useRef<{ revision: number; requestId: string } | null>(null);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  async function act(kind: "save" | "preview") {
    if (busy || !loaded) return;
    setBusy(true); setError(false); setResult(null);
    try {
      if (kind === "save") {
        const parsed = routingPolicySchema.parse(JSON.parse(draft)), revision = policy?.revision ?? 0;
        if (saveRetry.current?.text !== draft || saveRetry.current.revision !== revision) saveRetry.current = { text: draft, revision, requestId: crypto.randomUUID() };
        const saved = await api.save(companyId, { expectedRevision: revision, requestId: saveRetry.current.requestId, policy: parsed });
        if (active.current) { setPolicy(saved); setDraft(JSON.stringify(saved.policy, null, 2)); saveRetry.current = null; previewRetry.current = null; }
      } else if (policy) {
        if (previewRetry.current?.revision !== policy.revision) previewRetry.current = { revision: policy.revision, requestId: crypto.randomUUID() };
        const receipt = await api.preview(companyId, { requestId: previewRetry.current.requestId, policyRevision: policy.revision });
        if (active.current) { setResult(receipt); previewRetry.current = null; }
      }
    } catch (failure) { if (active.current) {
      setError(true);
      if (failure && typeof failure === "object" && "status" in failure && [401, 403].includes(Number(failure.status))) {
        setDraft(""); setPolicy(null); setResult(null); setLoaded(false);
      }
    } }
    finally { if (active.current) setBusy(false); }
  }
  if (!loaded) return <p role="alert">{t("costRoutingPreview.error")}</p>;
  return <section className="space-y-4">
    <h1 className="text-xl font-semibold">{t("costRoutingPreview.title")}</h1>
    <p className="text-sm text-muted-foreground">{t("costRoutingPreview.warning")}</p>
    {error && <p role="alert">{t("costRoutingPreview.error")}</p>}
    <label className="block space-y-2"><span>{t("costRoutingPreview.policy")}</span>
      <textarea className="min-h-32 w-full rounded-md border border-border bg-background p-3 font-mono text-xs"
        value={draft} disabled={busy || !loaded} onChange={event => { setDraft(event.target.value); setResult(null); }} /></label>
    <p>{t("costRoutingPreview.revision")}: {policy?.revision ?? 0}</p>
    <div className="flex gap-2">
      <Button disabled={busy || !loaded} onClick={() => void act("save")}>{t("costRoutingPreview.save")}</Button>
      <Button disabled={busy || !policy || draft !== JSON.stringify(policy.policy, null, 2)} onClick={() => void act("preview")}>{t("costRoutingPreview.preview")}</Button>
    </div>
    {result && <div className="space-y-2" aria-live="polite">
      <h2 className="font-semibold">{t("costRoutingPreview.receipt")}</h2>
      <pre className="overflow-auto rounded-md border border-border p-3 text-xs">{JSON.stringify(result, null, 2)}</pre>
    </div>}
  </section>;
}
