import { useTranslation } from "@/i18n";
import { createContext, useContext } from "react";
import { ArrowRight, Crown, Loader2 } from "lucide-react";
import type { Agent } from "@paperclipai/shared";
import { AgentAvatar } from "@/components/AgentAvatar";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** Shared presentation for the application and the approved review stories. */
export interface PrimaryAgentPresentation {
  companyId: string;
  primaryAgentId: string | null;
  primaryAgent: Agent | null;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  pendingAgentId?: string | null;
  onChange: (agentId: string) => void;
}

const PrimaryAgentContext = createContext<PrimaryAgentPresentation | null>(null);
export const PrimaryAgentPresentationProvider = PrimaryAgentContext.Provider;

export function usePrimaryAgentPresentation(companyId?: string | null) {
  const value = useContext(PrimaryAgentContext);
  return value && (!companyId || value.companyId === companyId) ? value : null;
}

export function PrimaryAgentIndicator({ agentId, companyId }: { agentId: string; companyId?: string }) {
  const { t } = useTranslation();
  const primary = usePrimaryAgentPresentation(companyId);
  if (!primary || primary.loading || primary.primaryAgentId !== agentId) return null;
  return <Tooltip>
    <TooltipTrigger asChild>
      <span role="img" aria-label={t("agentConfigurationUi.myPrimary")} className="inline-flex shrink-0 text-primary">
        <Crown aria-hidden="true" className="size-3.5" />
      </span>
    </TooltipTrigger>
    <TooltipContent>{t("agentConfigurationUi.myPrimary")}</TooltipContent>
  </Tooltip>;
}

export function SetPrimaryAgentButton({ agent }: {
  agent: Agent;
}) {
  const { t } = useTranslation();
  const primary = usePrimaryAgentPresentation(agent.companyId);
  if (!primary || agent.status === "terminated" || agent.status === "pending_approval") return null;
  if (primary.error) return <Button type="button" variant="link" size="sm" onClick={primary.onRetry}
    className="h-auto justify-start p-0 text-xs text-destructive">{t("agentConfigurationUi.retryPrimary")}</Button>;
  const selected = primary.primaryAgentId === agent.id;
  const pending = primary.pendingAgentId === agent.id;
  if (selected && !pending && !primary.loading) return null;
  const previous = primary.primaryAgent?.id === primary.primaryAgentId ? primary.primaryAgent : null;
  const loading = primary.loading || Boolean(primary.primaryAgentId && !previous);
  const disabled = loading || Boolean(primary.pendingAgentId);
  const button = <Button type="button" variant="link" size="sm" disabled={disabled}
    onClick={primary.primaryAgentId ? undefined : () => primary.onChange(agent.id)}
    className="h-auto justify-start p-0 text-xs text-muted-foreground hover:text-foreground">
    {pending || loading ? <Loader2 aria-hidden="true" className="size-3 motion-safe:animate-spin" /> : null}
    {loading ? t("agentConfigurationUi.loadingPrimary") : pending ? t("agentConfigurationUi.settingPrimary") : t("agentConfigurationUi.setPrimary")}
  </Button>;
  if (!previous) return button;
  return <AlertDialog key={previous.id}>
    <AlertDialogTrigger asChild>{button}</AlertDialogTrigger>
    <AlertDialogContent>
      <div className="flex items-start justify-center gap-5 pt-2">
        <div className="flex min-w-0 flex-1 flex-col items-center gap-2 text-center">
          <AgentAvatar agent={previous} size={64} label={t("agentConfigurationUi.avatar", { name: previous.name })} />
          <span className="max-w-full break-words text-sm font-medium">{previous.name}</span>
        </div>
        <ArrowRight aria-hidden="true" className="mt-5 size-6 shrink-0 text-muted-foreground" />
        <div className="flex min-w-0 flex-1 flex-col items-center gap-2 text-center">
          <AgentAvatar agent={agent} size={64} label={t("agentConfigurationUi.avatar", { name: agent.name })}
            className="rounded-xl ring-1 ring-primary ring-offset-2 ring-offset-background" />
          <span className="flex max-w-full items-center justify-center gap-1.5 text-sm font-medium">
            <span className="min-w-0 break-words">{agent.name}</span>
            <span role="img" aria-label={t("agentConfigurationUi.newPrimary")} className="inline-flex shrink-0 text-primary">
              <Crown aria-hidden="true" className="size-3.5" />
            </span>
          </span>
        </div>
      </div>
      <AlertDialogHeader>
        <AlertDialogTitle>{t("agentConfigurationUi.changePrimaryTitle")}</AlertDialogTitle>
        <AlertDialogDescription className="break-words">
          {t("agentConfigurationUi.changePrimaryDescription", { name: agent.name })}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter className="flex-row justify-between sm:justify-between">
        <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
        <AlertDialogAction disabled={disabled} onClick={() => primary.onChange(agent.id)}>{t("agentConfigurationUi.setPrimary")}</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}
