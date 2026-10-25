import { MimouseNotificationReview } from "@/components/MimouseNotificationReview";
import { useEffect as usePageEffect } from "react";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "@/i18n";
import { useCompany } from "@/context/CompanyContext";
import { notificationApi, type NotificationEndpoint, type NotificationPreview } from "@/api/mimouse-notifications";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
const kinds = ["wecom_webhook", "feishu_webhook", "dingtalk_webhook_legacy", "dingtalk_app", "wechat_official_account"];
export function MimouseNotifications() {
  const { t: pageT, i18n: pageI18n } = useTranslation();
  const { setBreadcrumbs } = useBreadcrumbs();
  usePageEffect(() => { setBreadcrumbs([{ label: pageT("notifications.title") }]); }, [setBreadcrumbs, pageI18n.language, pageT]);
  const { t } = useTranslation(); const { selectedCompanyId } = useCompany();
  return selectedCompanyId ? <NotificationCompany key={selectedCompanyId} companyId={selectedCompanyId} /> : <p>{t("notifications.selectCompany")}</p>;
}
function NotificationCompany({ companyId }: { companyId: string }) {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const key = ["mimouse-notifications", companyId];
  const query = useQuery({ queryKey: key, queryFn: () => notificationApi.get(companyId), refetchInterval: 10000 });
  const [reviewing, setReviewing] = useState<{ id: string; state: string; attempt: number } | null>(null);
  const [editing, setEditing] = useState<NotificationEndpoint | null>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const history = useQuery({ queryKey: [...key, "revisions", historyId], queryFn: () => notificationApi.history(companyId, historyId!), enabled: historyId !== null });
  const [name, setName] = useState(""); const [kind, setKind] = useState(kinds[0]);
  const [secretRef, setSecretRef] = useState(""); const [version, setVersion] = useState("1");
  const [brand, setBrand] = useState("feishu");
  const previewSequence = useRef(0);
  const [retrying, setRetrying] = useState<{ preview: NotificationPreview; requestId: string } | null>(null);
  const [reviewed, setReviewed] = useState(false); const [duplicateRisk, setDuplicateRisk] = useState(false);
  const [target, setTarget] = useState(""); const [robotCode, setRobotCode] = useState(""); const [templateId, setTemplateId] = useState(""); const [fields, setFields] = useState("{}");
  const [testing, setTesting] = useState<{ endpoint: NotificationEndpoint; requestId: string } | null>(null);
  const [testTitle, setTestTitle] = useState(""); const [testText, setTestText] = useState("");
  const mutation = useMutation({ mutationFn: async (action: () => Promise<unknown>) => action(), onSuccess: async () => { await client.invalidateQueries({ queryKey: key }); setTesting(null); setRetrying(null); } });
  const dispatchEnabled = query.data?.dispatchEnabled ?? query.data?.enabled ?? false;
  function clearDraft() { setEditing(null); setName(""); setKind(kinds[0]); setSecretRef(""); setVersion("1"); setBrand("feishu"); setTarget(""); setRobotCode(""); setTemplateId(""); setFields("{}"); }
  function edit(endpoint: NotificationEndpoint) {
    setTesting(null); setEditing(endpoint); setName(endpoint.name); setKind(endpoint.kind); setSecretRef(endpoint.secretRef); setVersion(String(endpoint.secretVersion));
    setBrand(endpoint.config.brand === "lark" ? "lark" : "feishu"); setTarget(String(endpoint.config.target ?? "")); setRobotCode(String(endpoint.config.robotCode ?? "")); setTemplateId(String(endpoint.config.templateId ?? "")); setFields(JSON.stringify(endpoint.config.templateData ?? {}, null, 2));
  }
  return <div className="space-y-6 max-w-4xl">
    <h1 className="text-xl font-semibold">{t("notifications.title")}</h1>
    <p className="text-sm text-muted-foreground">{t("notifications.privacy")}</p>
    {query.isLoading && <p>{t("common.loading")}</p>}
    {query.error && <p role="alert">{t("notifications.loadError")}</p>}
    {mutation.error && <p role="alert">{t("notifications.operationError")}</p>}
    {query.data && <>
      <p>{dispatchEnabled ? t("notifications.workerOn") : t("notifications.workerOff")}</p>
      <p className="text-sm">{t("notifications.notLive")}</p>
      <form className="space-y-3 rounded-lg border border-border p-4" onKeyDown={event => { if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault(); }} onSubmit={event => {
        event.preventDefault();
        mutation.mutate(async () => { const input = { name, kind, secretRef, secretVersion: Number(version), config: {
          ...(kind === "feishu_webhook" ? { brand } : {}),
          ...(kind === "dingtalk_app" ? { target, robotCode } : {}),
          ...(kind === "wechat_official_account" ? { target, templateId, templateData: JSON.parse(fields) } : {}),
        } };
          if (editing) await notificationApi.revise(companyId, editing.id, { ...input, expectedVersion: editing.configVersion });
          else await notificationApi.create(companyId, input);
          clearDraft();
        });
      }}>
        <h2 className="font-medium">{t(editing ? "notifications.edit" : "notifications.add")}</h2>
        {editing && <p role="status">{t("notifications.revisionWarning", { version: editing.configVersion })}</p>}
        <Label htmlFor="channel-name">{t("notifications.name")}</Label><Input id="channel-name" value={name} onChange={e => setName(e.target.value)} required />
        <Label htmlFor="channel-kind">{t("notifications.kind")}</Label>
        <select disabled={editing !== null} id="channel-kind" className="rounded-md border border-border bg-background p-2" value={kind} onChange={e => setKind(e.target.value)}>{kinds.map(value => <option key={value} value={value}>{t(`notifications.${value}`)}</option>)}</select>
        {kind === "feishu_webhook" && <><Label htmlFor="channel-brand">{t("notifications.serviceRegion")}</Label><select id="channel-brand" className="rounded-md border border-border bg-background p-2" value={brand} onChange={e => setBrand(e.target.value)}><option value="feishu">Feishu</option><option value="lark">Lark</option></select></>}
        <Label htmlFor="channel-secret">{t("notifications.secretRef")}</Label><Input id="channel-secret" value={secretRef} onChange={e => setSecretRef(e.target.value)} required />
        <Label htmlFor="channel-version">{t("notifications.secretVersion")}</Label><Input id="channel-version" type="number" min={1} value={version} onChange={e => setVersion(e.target.value)} required />
        {(kind === "dingtalk_app" || kind === "wechat_official_account") && <><Label htmlFor="channel-target">{t("notifications.target")}</Label><Input id="channel-target" value={target} onChange={e => setTarget(e.target.value)} required /></>}
        {kind === "dingtalk_app" && <><Label htmlFor="channel-robot">{t("notifications.robotCode")}</Label><Input id="channel-robot" value={robotCode} onChange={e => setRobotCode(e.target.value)} required /></>}
        {kind === "wechat_official_account" && <><Label htmlFor="channel-template">{t("notifications.templateId")}</Label><Input id="channel-template" value={templateId} onChange={e => setTemplateId(e.target.value)} required /><Label htmlFor="channel-fields">{t("notifications.templateFields")}</Label><Input id="channel-fields" value={fields} onChange={e => setFields(e.target.value)} required /></>}
        <p className="text-sm text-muted-foreground">{t("notifications.saveHelp")}</p>
        <div className="flex justify-between"><Button type="button" variant="outline" disabled={mutation.isPending} onClick={clearDraft}>{t("common.cancel")}</Button><Button disabled={mutation.isPending}>{t("common.save")}</Button></div>
      </form>
      <section className="space-y-3"><h2 className="font-medium">{t("notifications.channels")}</h2>
        {!query.data.endpoints.length && <p>{t("notifications.empty")}</p>}
        {query.data.endpoints.map(endpoint => <div key={endpoint.id} className="rounded-lg border border-border p-4 space-y-2">
          <h3>{endpoint.name} · {t(`notifications.${endpoint.kind === "feishu_webhook" && endpoint.config.brand === "lark" ? "lark_webhook" : endpoint.kind}`)}</h3>
          <p>{t("notifications.configVersion", { version: endpoint.configVersion })}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={mutation.isPending} onClick={() => edit(endpoint)}>{t("notifications.edit")}</Button>
            <Button variant="outline" onClick={() => setHistoryId(endpoint.id)}>{t("notifications.history")}</Button>
            <Button variant="outline" disabled={mutation.isPending} onClick={() => mutation.mutate(() => notificationApi.toggle(companyId, endpoint.id, !endpoint.enabled, endpoint.configVersion))}>{endpoint.enabled ? t("notifications.pause") : t("notifications.enable")}</Button>
            <Button variant="outline" disabled={!endpoint.enabled || !dispatchEnabled || mutation.isPending} onClick={() => { setTesting({ endpoint, requestId: crypto.randomUUID() }); setTestTitle(t("notifications.testTitle")); setTestText(t("notifications.testText")); }}>{t("notifications.test")}</Button>
          </div>
          <p className="text-sm text-muted-foreground">{t("notifications.subscriptionHelp")}</p>
          <div className="space-y-2" aria-label={t("notifications.subscriptions")}>
            {query.data!.connectedEvents.map(eventType => {
              const subscription = query.data!.subscriptions.find(item => item.endpointId === endpoint.id && item.eventType === eventType);
              const enabled = subscription?.enabled === true;
              const label = t(`notifications.event_${eventType.replaceAll(".", "_")}`, { defaultValue: eventType });
              return <div key={eventType} className="flex flex-wrap items-center gap-2">
                <span>{label}</span><span className="text-xs text-muted-foreground">{subscription?.locale ?? i18n.language}</span>
                <Button variant="outline" aria-label={`${label}: ${enabled ? t("notifications.pauseSubscription") : t("notifications.enableSubscription")}`} disabled={mutation.isPending} onClick={() => mutation.mutate(() => enabled ? notificationApi.toggleSubscription(companyId, subscription!.id, false) : notificationApi.subscribe(companyId, endpoint.id, eventType, i18n.language))}>{enabled ? t("notifications.pauseSubscription") : t("notifications.enableSubscription")}</Button>
                {enabled && subscription.locale !== i18n.language && <Button variant="outline" disabled={mutation.isPending} onClick={() => mutation.mutate(() => notificationApi.subscribe(companyId, endpoint.id, eventType, i18n.language))}>{t("notifications.useCurrentLanguage")}</Button>}
              </div>;
            })}
          </div>
        </div>)}
      </section>
      {historyId && <section className="rounded-lg border border-border p-4 space-y-3" aria-label={t("notifications.history")}>
        <h2>{t("notifications.history")}</h2>
        {history.isLoading && <p>{t("common.loading")}</p>}
        {history.error && <p role="alert">{t("notifications.loadError")}</p>}
        {history.data?.map(revision => <div key={revision.id} className="space-y-2">
          <h3>{t("notifications.configVersion", { version: revision.configVersion })} · {revision.snapshot.name}</h3>
          <p>{revision.actorId} · {new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(revision.createdAt))}</p>
          <pre className="whitespace-pre-wrap break-words text-sm">{JSON.stringify(revision.snapshot.config, null, 2)}</pre>
          <p>{t("notifications.secretRef")}: {revision.snapshot.secretRef} · {t("notifications.secretVersion")}: {revision.snapshot.secretVersion}</p>
        </div>)}
        <Button variant="outline" onClick={() => setHistoryId(null)}>{t("common.cancel")}</Button>
      </section>}
      {testing && <section className="rounded-lg border border-border p-4 space-y-3">
        <h2>{t("notifications.confirmTarget", { name: testing.endpoint.name })}</h2>
        <p>{t("notifications.testWarning")}</p>
        <Label htmlFor="test-title">{t("notifications.messageTitle")}</Label><Input id="test-title" value={testTitle} onChange={e => setTestTitle(e.target.value)} />
        <Label htmlFor="test-text">{t("notifications.messageText")}</Label><Input id="test-text" value={testText} onChange={e => setTestText(e.target.value)} />
        <div className="flex justify-between"><Button variant="outline" onClick={() => setTesting(null)}>{t("common.cancel")}</Button><Button disabled={mutation.isPending || !testTitle || !testText} onClick={() => mutation.mutate(() => notificationApi.test(companyId, testing.endpoint.id, { expectedVersion: testing.endpoint.configVersion, requestId: testing.requestId, confirm: true, title: testTitle, text: testText }))}>{t("notifications.confirmSend")}</Button></div>
      </section>}
      {retrying && <section className="rounded-lg border border-border p-4 space-y-3">
        <h2>{t("notifications.retryTitle")}: {retrying.preview.endpointName}</h2>
        <p>{retrying.preview.id} · {retrying.preview.target ?? retrying.preview.endpointName} · {t("notifications.secretVersion")}: {retrying.preview.secretVersion}</p>
        <h3>{retrying.preview.title}</h3><pre className="whitespace-pre-wrap text-sm">{retrying.preview.text}</pre>
        {retrying.preview.templateData && <pre className="whitespace-pre-wrap text-sm">{JSON.stringify(retrying.preview.templateData, null, 2)}</pre>}
        <p>{t("notifications.retryWarning")}</p>
        <label className="flex items-center gap-2"><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} />{t("notifications.reviewedOutcome")}</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={duplicateRisk} onChange={e => setDuplicateRisk(e.target.checked)} />{t("notifications.acceptDuplicateRisk")}</label>
        <div className="flex justify-between"><Button variant="outline" onClick={() => setRetrying(null)}>{t("common.cancel")}</Button><Button disabled={!reviewed || !duplicateRisk || mutation.isPending || !dispatchEnabled} onClick={() => mutation.mutate(() => notificationApi.retry(companyId, retrying.preview.id, retrying.requestId))}>{t("notifications.confirmRetry")}</Button></div>
      </section>}
      {reviewing && <MimouseNotificationReview key={reviewing.id} companyId={companyId} delivery={reviewing} onClose={() => setReviewing(null)} />}
      <section className="space-y-2"><h2 className="font-medium">{t("notifications.deliveries")}</h2>
        {query.data.deliveries.map(delivery => <div key={delivery.id} className="space-y-1"><p className="font-mono text-sm">{delivery.id} · {t(`notifications.state_${delivery.state}`)} · {delivery.lastCode ?? "—"}</p>
          {["accepted", "indeterminate", "rejected"].includes(delivery.state) && <Button variant="outline" onClick={() => { setRetrying(null); setReviewing(delivery); }}>{t("notifications.reviewDelivery")}</Button>}
          {["indeterminate", "rejected"].includes(delivery.state) && !["snapshot_render_failed", "unsupported_render_version"].includes(delivery.lastCode ?? "") && <Button variant="outline" disabled={mutation.isPending} onClick={async () => { const sequence = ++previewSequence.current; setRetrying(null); setReviewed(false); setDuplicateRisk(false); try { const preview = await notificationApi.preview(companyId, delivery.id); if (sequence !== previewSequence.current) return; setReviewed(false); setDuplicateRisk(false); setRetrying({ preview, requestId: crypto.randomUUID() }); } catch { if (sequence === previewSequence.current) mutation.mutate(() => Promise.reject(Error("preview_failed"))); } }}>{t("notifications.reviewRetry")}</Button>}
        </div>)}
      </section>
      {query.data.unconnectedEvents.length > 0 && <p className="text-sm text-muted-foreground">{t("notifications.unconnected")}: {query.data.unconnectedEvents.join(", ")}</p>}
    </>}
  </div>;
}
