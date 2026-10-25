import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "@/i18n";
import { useCompany } from "@/context/CompanyContext";
import { notificationApi, type NotificationEndpoint } from "@/api/mimouse-notifications";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
const kinds = ["wecom_webhook", "feishu_webhook", "dingtalk_webhook_legacy", "dingtalk_app", "wechat_official_account"];
export function MimouseNotifications() {
  const { t, i18n } = useTranslation();
  const { selectedCompanyId } = useCompany();
  const client = useQueryClient();
  const key = ["mimouse-notifications", selectedCompanyId];
  const query = useQuery({ queryKey: key, queryFn: () => notificationApi.get(selectedCompanyId!), enabled: !!selectedCompanyId, refetchInterval: 10000 });
  const [name, setName] = useState(""); const [kind, setKind] = useState(kinds[0]);
  const [secretRef, setSecretRef] = useState(""); const [version, setVersion] = useState("1");
  const [target, setTarget] = useState(""); const [robotCode, setRobotCode] = useState(""); const [templateId, setTemplateId] = useState(""); const [fields, setFields] = useState("{}");
  const [testing, setTesting] = useState<{ endpoint: NotificationEndpoint; requestId: string } | null>(null);
  const [testTitle, setTestTitle] = useState(""); const [testText, setTestText] = useState("");
  useEffect(() => { setTesting(null); setName(""); setSecretRef(""); setTarget(""); setRobotCode(""); setTemplateId(""); setFields("{}"); }, [selectedCompanyId]);
  const mutation = useMutation({ mutationFn: async (action: () => Promise<unknown>) => action(), onSuccess: async () => { await client.invalidateQueries({ queryKey: key }); setTesting(null); } });
  if (!selectedCompanyId) return <p>{t("notifications.selectCompany")}</p>;
  const companyId = selectedCompanyId;
  return <div className="space-y-6 max-w-4xl">
    <h1 className="text-xl font-semibold">{t("notifications.title")}</h1>
    <p className="text-sm text-muted-foreground">{t("notifications.privacy")}</p>
    {query.isLoading && <p>{t("common.loading")}</p>}
    {query.error && <p role="alert">{t("notifications.loadError")}</p>}
    {mutation.error && <p role="alert">{t("notifications.operationError")}</p>}
    {query.data && <>
      <p>{query.data.enabled ? t("notifications.workerOn") : t("notifications.workerOff")}</p>
      <p className="text-sm">{t("notifications.notLive")}</p>
      <form className="space-y-3 rounded-lg border border-border p-4" onKeyDown={event => { if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault(); }} onSubmit={event => {
        event.preventDefault();
        mutation.mutate(async () => notificationApi.create(companyId, { name, kind, secretRef, secretVersion: Number(version), config: {
          ...(kind === "dingtalk_app" ? { target, robotCode } : {}),
          ...(kind === "wechat_official_account" ? { target, templateId, templateData: JSON.parse(fields) } : {}),
        } }));
      }}>
        <h2 className="font-medium">{t("notifications.add")}</h2>
        <Label htmlFor="channel-name">{t("notifications.name")}</Label><Input id="channel-name" value={name} onChange={e => setName(e.target.value)} required />
        <Label htmlFor="channel-kind">{t("notifications.kind")}</Label>
        <select id="channel-kind" className="rounded-md border border-border bg-background p-2" value={kind} onChange={e => setKind(e.target.value)}>{kinds.map(value => <option key={value} value={value}>{t(`notifications.${value}`)}</option>)}</select>
        <Label htmlFor="channel-secret">{t("notifications.secretRef")}</Label><Input id="channel-secret" value={secretRef} onChange={e => setSecretRef(e.target.value)} required />
        <Label htmlFor="channel-version">{t("notifications.secretVersion")}</Label><Input id="channel-version" type="number" min={1} value={version} onChange={e => setVersion(e.target.value)} required />
        {(kind === "dingtalk_app" || kind === "wechat_official_account") && <><Label htmlFor="channel-target">{t("notifications.target")}</Label><Input id="channel-target" value={target} onChange={e => setTarget(e.target.value)} required /></>}
        {kind === "dingtalk_app" && <><Label htmlFor="channel-robot">{t("notifications.robotCode")}</Label><Input id="channel-robot" value={robotCode} onChange={e => setRobotCode(e.target.value)} required /></>}
        {kind === "wechat_official_account" && <><Label htmlFor="channel-template">{t("notifications.templateId")}</Label><Input id="channel-template" value={templateId} onChange={e => setTemplateId(e.target.value)} required /><Label htmlFor="channel-fields">{t("notifications.templateFields")}</Label><Input id="channel-fields" value={fields} onChange={e => setFields(e.target.value)} required /></>}
        <p className="text-sm text-muted-foreground">{t("notifications.saveHelp")}</p>
        <div className="flex justify-end"><Button disabled={mutation.isPending}>{t("common.save")}</Button></div>
      </form>
      <section className="space-y-3"><h2 className="font-medium">{t("notifications.channels")}</h2>
        {!query.data.endpoints.length && <p>{t("notifications.empty")}</p>}
        {query.data.endpoints.map(endpoint => <div key={endpoint.id} className="rounded-lg border border-border p-4 space-y-2">
          <h3>{endpoint.name} · {t(`notifications.${endpoint.kind}`)}</h3>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={mutation.isPending} onClick={() => mutation.mutate(() => notificationApi.toggle(companyId, endpoint.id, !endpoint.enabled))}>{endpoint.enabled ? t("notifications.pause") : t("notifications.enable")}</Button>
            <Button variant="outline" disabled={mutation.isPending} onClick={() => mutation.mutate(() => notificationApi.subscribe(companyId, endpoint.id, "approval.requested", i18n.language))}>{t("notifications.subscribeApproval")}</Button>
            <Button variant="outline" disabled={!endpoint.enabled || !query.data!.enabled || mutation.isPending} onClick={() => { setTesting({ endpoint, requestId: crypto.randomUUID() }); setTestTitle(t("notifications.testTitle")); setTestText(t("notifications.testText")); }}>{t("notifications.test")}</Button>
          </div>
        </div>)}
      </section>
      {testing && <section className="rounded-lg border border-border p-4 space-y-3">
        <h2>{t("notifications.confirmTarget", { name: testing.endpoint.name })}</h2>
        <p>{t("notifications.testWarning")}</p>
        <Label htmlFor="test-title">{t("notifications.messageTitle")}</Label><Input id="test-title" value={testTitle} onChange={e => setTestTitle(e.target.value)} />
        <Label htmlFor="test-text">{t("notifications.messageText")}</Label><Input id="test-text" value={testText} onChange={e => setTestText(e.target.value)} />
        <div className="flex justify-between"><Button variant="outline" onClick={() => setTesting(null)}>{t("common.cancel")}</Button><Button disabled={mutation.isPending || !testTitle || !testText} onClick={() => mutation.mutate(() => notificationApi.test(companyId, testing.endpoint.id, { requestId: testing.requestId, confirm: true, title: testTitle, text: testText }))}>{t("notifications.confirmSend")}</Button></div>
      </section>}
      <section className="space-y-2"><h2 className="font-medium">{t("notifications.deliveries")}</h2>
        {query.data.deliveries.map(delivery => <p key={delivery.id} className="font-mono text-sm">{delivery.id} · {t(`notifications.state_${delivery.state}`)} · {delivery.lastCode ?? "—"}</p>)}
      </section>
      <p className="text-sm text-muted-foreground">{t("notifications.unconnected")}: {query.data.unconnectedEvents.join(", ")}</p>
    </>}
  </div>;
}
