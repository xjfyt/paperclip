import { Trans } from "react-i18next";
import { useTranslation } from "@/i18n";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, ExternalLink, HelpCircle, Loader2, Plus, Trash2 } from "lucide-react";
import { InlineBanner } from "@/components/InlineBanner";
import { ActionsSection } from "@/pages/apps/app-detail/PermissionsPanel";
import { SetupWizardFooter } from "@/components/SetupWizard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { RemoteMcpManagement } from "./RemoteMcpManagement";
import {
  AccessStepContent,
  ConnectionAccessDefaults,
  connectionDefaultSummarySentence,
  StepHeader,
} from "../ConnectionSetupFlow";
import { remoteMcpProviderDisplay, type RemoteMcpProvider } from "./providers";
import type { RemoteMcpSetupActions, RemoteMcpSetupState } from "./types";

/**
 * PAP-659 C0: the connect path is one screen. `access` is still a real screen,
 * but only as management after the connection exists — the way in states the
 * resolved default and puts its controls in the Advanced disclosure, the same
 * as every catalog connector.
 */
const steps = ["connect"] as const;
const selectClass = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

function FieldHelp({ label, children }: { label: string; children: ReactNode }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return <Tooltip open={open} onOpenChange={setOpen}>
    <TooltipTrigger asChild><button type="button" aria-label={t("remoteMcpFormUi.helpWith", { label })} onClick={() => setOpen(!open)} className="rounded-sm text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><HelpCircle className="size-4" /></button></TooltipTrigger>
    <TooltipContent className="max-w-xs">{children}</TooltipContent>
  </Tooltip>;
}

/** Controlled presentation shared by provider setup, configuration imports and review stories.
 * Authentication, persistence and calls belong to the controller, never these views. */
export function RemoteMcpConnectionSetup({ provider, state: s, actions: a, agents, companyId, connectionId, fixedGrantKind, lockedAgentId, host = "page", authorizationUrl, upstreamServiceName, onCancel, additionalSettings, settingsValid = true }: {
  additionalSettings?: ReactNode;
  settingsValid?: boolean;
  companyId: string;
  onCancel?: () => void;
  upstreamServiceName?: string;
  host?: "page" | "dialog";
  lockedAgentId?: string;
  authorizationUrl?: string;
  provider: RemoteMcpProvider;
  connectionId: string;
  fixedGrantKind?: RemoteMcpSetupState["grantKind"];
  state: RemoteMcpSetupState;
  actions: RemoteMcpSetupActions;
  agents: { id: string; name: string }[];
}) {
  const { t } = useTranslation();
  const notice = typeof s.notice === "string" ? s.notice : s.notice ? t(s.notice.key) : null;
  const copy = remoteMcpProviderDisplay(provider, t);
  const uid = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const previousStep = useRef(s.step);
  const [sessionOpen, setSessionOpen] = useState(() => Boolean(provider.defaultUrl && s.url !== provider.defaultUrl));
  useEffect(() => {
    if (previousStep.current !== s.step) heading.current?.focus();
    previousStep.current = s.step;
  }, [s.step]);
  const currentStep = steps.indexOf(s.step as typeof steps[number]);
  const busy = s.connectStatus === "connecting";
  const change = (patch: Partial<RemoteMcpSetupState>) => a.edit(patch);
  const external = (purpose: Parameters<typeof a.openProvider>[0], text: string) => <Button type="button" variant="link" className="h-auto p-0 text-sm text-current underline" onClick={() => a.openProvider(purpose)}>{text}<ExternalLink className="size-3.5" aria-hidden="true" /></Button>;
  const boundary = <InlineBanner compact>
    Paperclip controls access to the tools listed here. App and action permissions inside these tools are managed in {external("manage", provider.name)}.
  </InlineBanner>;
  const footer = (children: ReactNode) => <SetupWizardFooter onSaveExit={a.saveExit} disabled={busy}>{children}</SetupWizardFooter>;

  /**
   * The stated default and the one Advanced disclosure (PAP-659 C0).
   *
   * Step 1 of this work learned the lesson the hard way on Gmail: adding an
   * access disclosure beside a connector's existing "Advanced authentication"
   * panel leaves two of them on one screen, which is worse than the step it
   * replaced. So the provider's authentication settings are passed in here as
   * `extra` and share a single panel with the access controls.
   */
  // Deliberately not derived from `s.auth`. A gateway URL can carry a personal
  // token even when the method declares `auth: "none"`, so the shared-vs-mine
  // credential choice has to stay offered; deriving "none" here would silently
  // remove it and pin every Zapier connection to the organization.
  const authKind = "oauth";
  const defaults = (extra: ReactNode) => <ConnectionAccessDefaults
    companyId={companyId}
    {...(companyId ? {} : { agents })}
    sentence={connectionDefaultSummarySentence({
      grantKind: s.grantKind,
      authKind,
      installChoice: s.allAgents ? "all" : "specific",
      installCount: s.agentIds.length,
      lockedAgentId,
      preserveAgentAccess: s.setupComplete,
    }, t)}
    extra={extra}
    // Something inside is load-bearing: the operator has already chosen a
    // non-default sign-in method, or the provider just rejected a credential.
    forceOpen={s.auth !== (provider.supportsBrowserAuth ? "auto" : "none") || s.connectStatus === "rejected"}
    disabled={busy}
    authKind={authKind}
    grantKinds={fixedGrantKind ? [fixedGrantKind] : undefined}
    grantKind={s.grantKind}
    setGrantKind={(grantKind) => { if (grantKind !== "agent") change({ grantKind }); }}
    installChoice={s.allAgents ? "all" : "specific"}
    setInstallChoice={(choice) => change({ allAgents: choice === "all" })}
    installAgentIds={new Set(s.agentIds)}
    setInstallAgentIds={(ids) => change({ agentIds: [...ids] })}
    lockedAgentId={lockedAgentId}
    preserveAgentAccess={s.setupComplete}
  />;

  const error = s.connectStatus === "invalid_url" ? { title: t("remoteMcpStatusUi.invalidUrlTitle"), body: t("remoteMcpStatusUi.invalidUrlBody", { httpsScheme: "https://", httpScheme: "http://" }) }
    : s.connectStatus === "oauth_failed" ? { title: t("connectionOAuthUi.errorTitle", { serverName: provider.name }), body: t("connectionOAuthUi.callbackIncomplete") }
    : s.connectStatus === "rejected" ? { title: t("remoteMcpStatusUi.credentialsRejected"), body: t("remoteMcpStatusUi.credentialsRejectedHelp", { provider: provider.name }) }
    : s.connectStatus === "unreachable" ? { title: t("remoteMcpStatusUi.unreachable"), body: t("remoteMcpStatusUi.unreachableHelp") }
    : null;
  const urlField = <div className="space-y-2">
    <div className="flex items-center gap-2"><Label htmlFor={`${uid}-url`}>{t("remoteMcpFormUi.serverUrl")}</Label><FieldHelp label={t("remoteMcpFormUi.serverUrl")}>{copy.urlHelp}</FieldHelp></div>
    <Input id={`${uid}-url`} type="password" autoComplete="off" spellCheck={false} placeholder={copy.placeholder} value={s.url} aria-invalid={s.connectStatus === "invalid_url"} aria-describedby={`${uid}-url-help`} onChange={(event) => change({ url: event.target.value })} />
    <p id={`${uid}-url-help`} className="text-xs text-muted-foreground">{copy.urlHelp}</p>
    {provider.id === "executor" ? <div className="space-y-2"><div className="flex items-center gap-2"><Label htmlFor={`${uid}-management`}>{t("remoteMcpFormUi.consoleUrl")}</Label>
      <FieldHelp label={t("remoteMcpFormUi.consoleLabel")}>{t("remoteMcpFormUi.consoleHelp")}</FieldHelp></div>
      <Input id={`${uid}-management`} type="url" value={s.managementUrl ?? ""} placeholder="https://executor.sh/your-organization/integrations" onChange={event => change({ managementUrl: event.target.value })} />
    </div> : null}
  </div>;

  return <div className={host === "dialog" ? "min-w-0 text-foreground" : "mx-auto max-w-6xl p-4 text-foreground sm:p-8"} data-remote-mcp-provider={provider.id}>
    <StepHeader headingRef={heading} appIdentity={{ name: provider.name, logoUrl: null }}
      title={upstreamServiceName ? t("remoteMcpStatusUi.connectThrough", { app: upstreamServiceName, provider: provider.name }) : s.step === "draft" ? "Continue your setup" : s.setupComplete ? s.step === "access" ? "Who can use this connection" : s.step === "connect" ? t("remoteMcpFormUi.reconnect", { provider: provider.name }) : provider.name : undefined}
      subtitle={currentStep >= 0 && !s.setupComplete ? t("remoteMcpFormUi.onYourBehalf", { provider: provider.name }) : s.step === "draft" ? `Your ${provider.name} setup is ready to resume.` : s.step === "permissions" ? `Connected${s.identity ? ` as ${s.identity}` : ""} · ${s.tools.length} actions available` : t("remoteMcpFormUi.manageConnection", { provider: provider.name })}
      step={currentStep >= 0 && !s.setupComplete ? "key" : "gallery"} activeIndex={currentStep} labels={steps.map(() => t("remoteMcpFormUi.connect"))} onCancel={busy || s.step === "management" || s.step === "permissions" || s.step === "draft" ? undefined : onCancel ?? a.saveExit} />
    <main className="space-y-6">
        {upstreamServiceName && <InlineBanner compact>{t("remoteMcpFormUi.upstreamHelp", { provider: provider.name, app: upstreamServiceName })} {provider.id === "composio" ? t("remoteMcpFormUi.composioAppHelp") : t("remoteMcpFormUi.gatewayAppHelp")}</InlineBanner>}
        {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}

        {s.step === "access" && <AccessStepContent agents={agents} lockedAgentId={lockedAgentId} authKind="oauth" grantKinds={fixedGrantKind ? [fixedGrantKind] : undefined} grantKind={s.grantKind} setGrantKind={(grantKind) => { if (grantKind !== "agent") change({ grantKind }); }}
          installChoice={s.allAgents ? "all" : "specific"} setInstallChoice={(choice) => change({ allAgents: choice === "all" })}
          installAgentIds={new Set(s.agentIds)} setInstallAgentIds={(ids) => change({ agentIds: [...ids] })}
          submitLabel={s.setupComplete ? "Done" : "Continue"} onBack={s.setupComplete ? a.finish : a.saveExit} onContinue={s.setupComplete ? a.finish : () => a.navigate("connect")} />}
        {s.step === "permissions" && <>
          <div className="flex items-center justify-between gap-3"><h2 className="text-sm font-semibold">Permissions</h2><Button variant="outline" onClick={a.finish}>Connection settings</Button></div>
          {s.tools.some((entry) => entry.broad) && boundary}
          <ActionsSection connectionId={connectionId} appName={provider.name}
            readOnly={s.tools.filter((entry) => entry.isReadOnly)} canChange={s.tools.filter((entry) => !entry.isReadOnly)} quarantined={[]}
            enabledIds={new Set(s.tools.filter((entry) => s.permissions[entry.id] !== "off").map((entry) => entry.id))}
            askFirstIds={new Set(s.tools.filter((entry) => s.permissions[entry.id] === "ask_first").map((entry) => entry.id))}
            disabled={!s.connected} refreshPending={s.refreshing} canConfigure
            onSetPermission={(ids, next) => change({ permissions: { ...s.permissions, ...Object.fromEntries(ids.map((id) => [id, next === "ask" ? "ask_first" : next])) } })}
            onReviewQuarantined={() => {}} onRefreshActions={a.refresh} />
        </>}
        <div className="mx-auto max-w-2xl space-y-6">
        {s.step === "connect" && <>
          <div className="space-y-3">
            <ol className="list-decimal space-y-2 pl-5 text-sm">{copy.instructions.map((instruction) => <li key={instruction}>{instruction}</li>)}</ol>
            {external("setup", t("remoteMcpFormUi.setupGuide", { provider: provider.name }))}
          </div>
          {s.connectStatus === "sign_in" && provider.supportsBrowserAuth ? <>
            <div role="status"><InlineBanner title={t("remoteMcpStatusUi.finishSignIn", { provider: provider.name })}>
              {t("remoteMcpStatusUi.waitingHelp")}
            </InlineBanner></div>
            <p className="text-sm text-muted-foreground"><Trans t={t} i18nKey="remoteMcpStatusUi.openAgainHelp" components={[authorizationUrl ? <a className="text-current underline" href={authorizationUrl} onClick={() => a.openProvider("sign_in")} target="_blank" rel="noopener noreferrer">{t("remoteMcpStatusUi.openAgain")}</a> : external("sign_in", t("remoteMcpStatusUi.openAgain"))]} /></p>
            {footer(<><Button variant="outline" onClick={a.cancelConnect}>{t("remoteMcpStatusUi.cancelSignIn")}</Button><Button disabled>{t("remoteMcpStatusUi.waiting")}</Button></>)}
          </> : <form className="space-y-6" onSubmit={(event) => { event.preventDefault(); a.connect(); }}>
            {error && <div role="alert"><InlineBanner tone="danger" title={error.title}>{error.body}</InlineBanner></div>}
            {s.connectStatus === "cancelled" && <p role="status" className="text-sm text-muted-foreground">{t("remoteMcpStatusUi.cancelled")}</p>}
            <fieldset disabled={busy} className="min-w-0 space-y-5">
              {provider.defaultUrl ? <Collapsible open={sessionOpen || s.connectStatus === "invalid_url"} onOpenChange={setSessionOpen}>
                <CollapsibleTrigger asChild><Button type="button" variant="link" className="h-auto p-0 text-sm text-muted-foreground underline underline-offset-2">{t("remoteMcpFormUi.reuseSession")}</Button></CollapsibleTrigger>
                <CollapsibleContent className="mt-3">{urlField}</CollapsibleContent>
              </Collapsible> : urlField}
              {defaults(<div className="space-y-4">
                  <p className="text-sm font-medium text-foreground">{t("remoteMcpFormUi.authentication")}</p>
                  <p className="text-sm text-muted-foreground">{copy.authHelp}</p>
                  <div className="space-y-2"><Label htmlFor={`${uid}-auth`}>{t("remoteMcpFormUi.signInMethod")}</Label><select id={`${uid}-auth`} className={selectClass} value={s.auth} onChange={(event) => change({ auth: event.target.value as RemoteMcpSetupState["auth"] })}>
                    {provider.supportsBrowserAuth && <option value="auto">{t("remoteMcpFormUi.automatic")}</option>}<option value="bearer">{t("remoteMcpFormUi.bearerToken")}</option><option value="headers">{t("remoteMcpFormUi.customHeaders")}</option><option value="none">{t("remoteMcpFormUi.noAdditionalAuth")}</option>
                  </select></div>
                  {s.auth === "bearer" && <div className="space-y-2"><div className="flex items-center gap-2"><Label htmlFor={`${uid}-token`}>{t("remoteMcpFormUi.bearerToken")}</Label><FieldHelp label={t("remoteMcpFormUi.bearerLabel")}>{t("remoteMcpFormUi.bearerHelp")}</FieldHelp></div><Input id={`${uid}-token`} type="password" autoComplete="off" value={s.token} onChange={(event) => change({ token: event.target.value })} /></div>}
                  {(s.auth === "bearer" || s.auth === "headers") && <div className="space-y-3">
                    <p className="text-sm font-medium">{s.auth === "bearer" ? t("remoteMcpFormUi.additionalHeaders") : t("remoteMcpFormUi.headers")}</p>
                    {s.headers.map((header, index) => <div key={header.id} className="flex flex-wrap items-end gap-2">
                      <div className="min-w-0 flex-1 space-y-2"><Label htmlFor={`${uid}-${header.id}-name`}>{t("remoteMcpFormUi.headerName", { index: index + 1 })}</Label><Input id={`${uid}-${header.id}-name`} value={header.name} placeholder={provider.id === "arcade" ? "Arcade-User-ID" : t("remoteMcpFormUi.headerPlaceholder")} onChange={(event) => change({ headers: s.headers.map((h) => h.id === header.id ? { ...h, name: event.target.value } : h) })} /></div>
                      <div className="min-w-0 flex-1 space-y-2"><Label htmlFor={`${uid}-${header.id}-value`}>{t("remoteMcpFormUi.headerValue", { index: index + 1 })}</Label><Input id={`${uid}-${header.id}-value`} type="password" autoComplete="off" value={header.value} onChange={(event) => change({ headers: s.headers.map((h) => h.id === header.id ? { ...h, value: event.target.value } : h) })} /></div>
                      <Button type="button" variant="ghost" size="icon" aria-label={t("remoteMcpFormUi.removeHeader", { index: index + 1 })} onClick={() => change({ headers: s.headers.filter((h) => h.id !== header.id) })}><Trash2 className="size-4" /></Button>
                    </div>)}
                    <Button type="button" variant="outline" size="sm" onClick={() => change({ headers: [...s.headers, { id: crypto.randomUUID(), name: "", value: "" }] })}><Plus className="size-4" />{t("remoteMcpFormUi.addHeader")}</Button>
                  </div>}
                </div>)}
            </fieldset>
            {additionalSettings}
            {busy && <p role="status" className="flex items-center gap-2 text-sm"><Loader2 className="size-4 animate-spin motion-reduce:animate-none" />{t("remoteMcpFormUi.discovering")}</p>}
            {footer(<>{s.setupComplete ? <Button type="button" variant="outline" disabled={busy} onClick={a.finish}>{t("connectionOAuthUi.back")}</Button> : <span />}<Button type="submit" disabled={busy || !s.url.trim() || !settingsValid}>{busy ? t("remoteMcpFormUi.connecting") : error || s.connectStatus === "cancelled" ? t("connectionOAuthUi.tryAgain") : t("connectionOAuthUi.headerConnect", { serverName: provider.name })}</Button></>)}
          </form>}
        </>}

        {s.step === "management" && <>
          {!s.connected ? <InlineBanner tone="warning" title="Disconnected">Agents cannot use this connection. Reconnect to restore access under the saved permission choices.</InlineBanner> : <div className="space-y-2"><p className="flex items-center gap-2 text-sm"><CheckCircle2 className="size-4" />Connected{s.identity ? ` as ${s.identity}` : ""}</p><p className="text-sm text-muted-foreground">{s.grantKind === "user" ? "Just me" : "Any human in the organization"} · {s.tools.length} tools · {s.allAgents ? "Any agent" : `${s.agentIds.length} agents with access`}</p></div>}
          <div className="flex flex-wrap gap-2"><Button onClick={() => a.navigate("access")}>Who can use this connection</Button><Button variant="outline" disabled={!s.connected} onClick={() => a.navigate("permissions")}>Permissions</Button></div>
          <p className="text-sm text-muted-foreground">Refresh the catalog after changing tools in {provider.name}. Existing Off and Ask first choices are preserved.</p>
          <Button variant="outline" disabled={!s.connected || s.refreshing} onClick={a.refresh}>{s.refreshing ? "Refreshing…" : "Refresh tools"}</Button>
          <RemoteMcpManagement providerName={provider.name} connected={s.connected} onReconnect={a.reconnect} onManage={() => a.openProvider("manage")} onDisconnect={a.disconnect} />
        </>}
        {s.step === "draft" && <><p className="text-sm">Your access choices and setup progress are kept with this connection.</p><div className="flex justify-end"><Button onClick={a.resumeDraft}>Resume setup</Button></div></>}
        </div>
    </main>
  </div>;
}
