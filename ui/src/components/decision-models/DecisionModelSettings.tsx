import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DECISION_MODELS, type DecisionConnectionChoice, type DecisionModelSettings, type DecisionProvider, type DecisionResult, type UpdateDecisionModel } from "@paperclipai/shared";
import { Link } from "@/lib/router";
import { useTranslation } from "@/i18n";
import { formatNumber } from "@/lib/utils";
import { decisionModelsApi } from "@/api/decision-models";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ToggleField } from "@/components/agent-config-primitives";
import { ConnectionChoiceList } from "@/features/connections/ConnectionChoiceList";
import { ConnectionSetupFlow } from "@/features/connections/ConnectionSetupFlow";
import { AppLogo } from "@/pages/apps/AppLogo";

const failureReasons = ["not_configured", "disabled", "connection_unavailable", "access_denied", "incompatible_connection", "budget_blocked", "provider_auth_failed", "provider_rate_limited", "timeout", "refused"];
export function DecisionModelSettingsView({ settings, choices, saving, testing, error, result, newlyConnectedId, onSave, onTest, onAdd }: {
  settings: DecisionModelSettings; choices: DecisionConnectionChoice[]; saving?: boolean; testing?: boolean;
  error?: string | null; result?: DecisionResult | null; newlyConnectedId?: string | null;
  onSave: (value: UpdateDecisionModel) => void; onTest: () => void; onAdd: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<Required<UpdateDecisionModel>>(settings);
  const appliedConnection = useRef<string | null>(null);
  useEffect(() => { setDraft(settings); }, [settings.companyId, settings.connectionId, settings.grantId, settings.enabled, settings.allowBackground]);
  useEffect(() => {
    if (!newlyConnectedId) { appliedConnection.current = null; return; }
    if (appliedConnection.current === newlyConnectedId) return;
    const connection = choices.find(row => row.id === newlyConnectedId);
    if (connection) {
      appliedConnection.current = newlyConnectedId;
      setDraft(value => ({ ...value, connectionId: connection.id, grantId: connection.grantId, enabled: value.connectionId ? value.enabled : true }));
    }
  }, [newlyConnectedId, choices]);
  const selected = choices.find(row => row.grantId === draft.grantId);
  const dirty = draft.enabled !== settings.enabled || draft.allowBackground !== settings.allowBackground || draft.grantId !== settings.grantId;
  const failureReason = result && result.status !== "succeeded" ? result.status === "unavailable" ? result.reason : result.errorCode : null;
  const unavailable = failureReason !== null ? t(failureReasons.includes(failureReason) ? `decisionSettingsUi.failure.${failureReason}` : "decisionSettingsUi.failure.fallback") : null;
  return <section aria-labelledby="decision-model-heading" className="max-w-2xl space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 id="decision-model-heading" className="text-lg font-semibold">{t("decisionSettingsUi.title")}</h2>
      <Link to="/activity/costs?tab=decisions" className="text-sm underline underline-offset-4">{t("decisionSettingsUi.viewUsage")}</Link>
    </div>
    <p className="text-sm text-muted-foreground">{t("decisionSettingsUi.description")}</p>
    <ConnectionChoiceList selectedId={draft.grantId ?? undefined} disabled={saving || testing}
      choices={choices.map(row => ({ id: row.grantId, name: row.name,
        description: `${row.decisionModel} · ${t(row.status === "connected" ? "decisionSettingsUi.connected" : "decisionSettingsUi.needsAttention")}`,
        icon: <AppLogo name={row.provider === "openai" ? "OpenAI" : "OpenRouter"} brandKey={row.provider} size={24} />,
      }))}
      onSelect={grantId => { const row = choices.find(choice => choice.grantId === grantId)!; setDraft(value => ({ ...value, connectionId: row.id, grantId, enabled: value.connectionId ? value.enabled : true })); }} />
    {choices.length === 0 && <p className="text-sm text-muted-foreground">{t("decisionSettingsUi.empty")}</p>}
    {draft.connectionId && !selected && <p role="status" className="text-sm text-muted-foreground">{t("decisionSettingsUi.unavailable")}</p>}
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="outline" size="sm" onClick={onAdd} disabled={saving || testing}>{t("decisionSettingsUi.addConnection")}</Button>
      {selected && <Link to={`/apps/${selected.id}/permissions`} className="text-sm underline underline-offset-4">{t(selected.status === "connected" ? "decisionSettingsUi.manageConnection" : "decisionSettingsUi.reconnectConnection")}</Link>}
    </div>
    {draft.connectionId && <fieldset disabled={saving || testing} className="space-y-4">
      <ToggleField label={t("decisionSettingsUi.enable")} checked={draft.enabled} onChange={enabled => setDraft(value => ({ ...value, enabled }))} />
      <div className="space-y-2">
        <ToggleField label={t("decisionSettingsUi.allowBackground")} checked={draft.allowBackground} onChange={allowBackground => setDraft(value => ({ ...value, allowBackground }))} />
        <p className="text-xs text-muted-foreground">{t("decisionSettingsUi.backgroundDescription")}</p>
      </div>
    </fieldset>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {!dirty && unavailable && <p role="alert" className="text-sm text-destructive">{unavailable}</p>}
    {!dirty && result?.status === "succeeded" && <div role="status" className="space-y-2 text-sm">
      <p className="font-medium">{t("decisionSettingsUi.working")}</p>
      <dl className="grid grid-cols-2 gap-2">{Object.entries(result.answers).map(([name, answer]) => <div key={name}>
        <dt className="text-muted-foreground">{["billing", "team", "severity"].includes(name) ? t(`decisionSettingsUi.answers.${name}`) : name}</dt>
        <dd className="font-mono">{answer.type === "boolean" ? formatNumber(Math.round(answer.probability * 100) / 100, { style: "percent", maximumFractionDigits: 0 }) : answer.type === "choice" ? answer.choice : `${formatNumber(answer.score, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / ${formatNumber(2)}`}</dd>
      </div>)}</dl>
      <p className="text-xs text-muted-foreground">{t("decisionSettingsUi.usageRecorded")}</p>
    </div>}
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="space-y-1">
        <Button variant="outline" size="sm" disabled={!settings.enabled || dirty || saving || testing || selected?.status !== "connected"} onClick={onTest}>{t(testing ? "decisionSettingsUi.testing" : "decisionSettingsUi.test")}</Button>
        <p className="text-xs text-muted-foreground">{t(dirty ? "decisionSettingsUi.saveBeforeTest" : "decisionSettingsUi.testCharge")}</p>
      </div>
      {dirty && <Button onClick={() => onSave(draft)} disabled={saving || testing || (draft.enabled && selected?.status !== "connected")}>{t(saving ? "decisionSettingsUi.saving" : "decisionSettingsUi.save")}</Button>}
    </div>
  </section>;
}

export function DecisionModelSettingsSection({ companyId }: { companyId: string }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const key = ["decision-model", companyId];
  const query = useQuery({ queryKey: key, queryFn: () => decisionModelsApi.settings(companyId) });
  const [adding, setAdding] = useState(false);
  const [provider, setProvider] = useState<DecisionProvider | null>(null);
  const [newlyConnectedId, setNewlyConnectedId] = useState<string | null>(null);
  const settingsRevision = JSON.stringify(query.data?.settings ?? { companyId });
  const test = useMutation({ mutationFn: (_revision: string) => decisionModelsApi.test(companyId), onSettled: () => { void client.invalidateQueries({ queryKey: ["decision-history", companyId] }); void client.invalidateQueries({ predicate: q => String(q.queryKey[0]).includes("cost") }); } });
  const resetTest = test.reset;
  useEffect(() => { resetTest(); }, [settingsRevision, resetTest]);
  const save = useMutation({ mutationFn: (settings: UpdateDecisionModel) => decisionModelsApi.update(companyId, settings), onSuccess: settings => {
    setNewlyConnectedId(null); test.reset(); client.setQueryData(key, { ...query.data, settings });
  } });
  if (query.isPending) return <p className="text-sm text-muted-foreground">{t("decisionSettingsUi.loading")}</p>;
  if (query.error) return <div role="alert" className="space-y-2"><p className="text-sm text-destructive">{t("decisionSettingsUi.loadFailed")}</p><Button variant="outline" onClick={() => void query.refetch()}>{t("decisionSettingsUi.retry")}</Button></div>;
  if (!query.data?.canManage || !query.data.settings) return null;
  return <>
    <DecisionModelSettingsView settings={query.data.settings} choices={query.data.choices} saving={save.isPending} testing={test.isPending}
      error={save.error?.message ?? (test.variables === settingsRevision ? test.error?.message : undefined)}
      result={test.variables === settingsRevision ? test.data : null} newlyConnectedId={newlyConnectedId}
      onSave={value => save.mutate(value)} onTest={() => test.mutate(settingsRevision)} onAdd={() => { setProvider(null); setAdding(true); }} />
    <Dialog open={adding} onOpenChange={setAdding}>
      <DialogContent className="sm:max-w-2xl max-h-(--sz-85vh) overflow-y-auto">
        <DialogHeader><DialogTitle>{t("decisionSettingsUi.addTitle")}</DialogTitle><DialogDescription>{t("decisionSettingsUi.addDescription")}</DialogDescription></DialogHeader>
        {provider ? <ConnectionSetupFlow host="dialog" serviceSlug={provider} forceNewConnection
          aiConnection={{ provider, method: "api_key", mode: "shared" }} requiredAiOwnership="shared"
          onCancel={() => setAdding(false)} onComplete={async result => {
            const refreshed = await query.refetch();
            if ("connectionId" in result && result.connectionId && refreshed.data?.choices.some(row => row.id === result.connectionId)) setNewlyConnectedId(result.connectionId);
            setAdding(false);
          }} /> : <ConnectionChoiceList choices={(Object.keys(DECISION_MODELS) as DecisionProvider[]).map(id => ({ id,
            name: id === "openai" ? "OpenAI" : "OpenRouter", description: DECISION_MODELS[id].name,
            icon: <AppLogo name={id === "openai" ? "OpenAI" : "OpenRouter"} brandKey={id} size={24} />,
          }))} onSelect={id => setProvider(id as DecisionProvider)} />}
      </DialogContent>
    </Dialog>
  </>;
}
