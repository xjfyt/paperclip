import { useEffect, useRef, useState } from "react";
import { useCompany } from "@/context/CompanyContext";
import { useTranslation } from "@/i18n";
import { Button } from "@/components/ui/button";
import { costRoutingPreviewApi as api } from "@/api/cost-routing-preview";
import { routingPolicySchema, type RoutingPolicyRecord, type RoutingPreviewRecord } from "@paperclipai/shared/cost-routing-preview";
export function CostRoutingPreview() {
  const { selectedCompanyId } = useCompany(), { t } = useTranslation();
  if (!selectedCompanyId) return <p>{t("costRoutingPreview.chooseCompany")}</p>;
  return <CompanyPolicy key={selectedCompanyId} companyId={selectedCompanyId} />;
}
function CompanyPolicy({ companyId }: { companyId: string }) {
  const { t } = useTranslation(), active = useRef(true);
  const [policy, setPolicy] = useState<RoutingPolicyRecord | null>(null), [draft, setDraft] = useState("");
  const [result, setResult] = useState<RoutingPreviewRecord | null>(null), [busy, setBusy] = useState(true);
  const [error, setError] = useState(false), [loaded, setLoaded] = useState(false);
  const saveRetry = useRef<{ text: string; revision: number; requestId: string } | null>(null);
  const previewRetry = useRef<{ revision: number; requestId: string } | null>(null);
  useEffect(() => {
    active.current = true; const controller = new AbortController();
    api.current(companyId, controller.signal).then(value => {
      if (!active.current) return;
      setPolicy(value); setDraft(value ? JSON.stringify(value.policy, null, 2) : ""); setLoaded(true);
    }).catch(() => { if (active.current) setError(true); }).finally(() => { if (active.current) setBusy(false); });
    return () => { active.current = false; controller.abort(); };
  }, [companyId]);
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
    } catch { if (active.current) setError(true); }
    finally { if (active.current) setBusy(false); }
  }
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
