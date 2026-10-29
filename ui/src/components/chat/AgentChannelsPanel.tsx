import { useTranslation } from "@/i18n";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, MessageSquarePlus } from "lucide-react";
import { chatEndpointsApi, type ChatProvider } from "@/api/chatEndpoints";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import { queryKeys } from "@/lib/queryKeys";
import { Link } from "@/lib/router";
import { useChatConnectorsEnabled, chatProviderVisible } from "@/hooks/useChatConnectorsEnabled";

const providerNames: Record<ChatProvider, string> = {
  speko: "Speko",
  slack: "Slack",
  github: "GitHub Code Review Bot",
  discord: "Discord",
  "microsoft-teams": "Microsoft Teams",
  telegram: "Telegram",
  "imessage-photon": "iMessage Photon",
  agentmail: "AgentMail",
};

const endpointStatusKeys: Record<string, string> = { draft: "statuses.draft", verifying: "agentChannelsUi.verifying", active: "statuses.active", paused: "statuses.paused", attention: "agentChannelsUi.attention", revoked: "agentChannelsUi.revoked" };

export function AgentChannelsPanel({
  companyId,
  agentId,
}: {
  companyId: string;
  agentId: string;
}) {
  const { t } = useTranslation();
  const { enabled, githubEnabled } = useChatConnectorsEnabled();
  const query = useQuery({
    queryKey: queryKeys.chatEndpoints.list(companyId),
    queryFn: () => chatEndpointsApi.list(companyId),
    enabled: Boolean(companyId),
  });
  // Capture the value before isError narrows TanStack's discriminated union.
  // Preserve string rejections without widening the query's error type.
  const queryError = query.error;
  const errorMessage = queryError instanceof Error ? queryError.message : typeof queryError === "string" ? queryError : null;
  const endpoints = (query.data ?? []).filter(
    (endpoint) =>
      endpoint.assignedAgentId === agentId && endpoint.status !== "archived" && chatProviderVisible(endpoint.provider, enabled, githubEnabled),
  );
  return (
    <section className="max-w-3xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t("agentChannelsUi.title")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("agentChannelsUi.description")}
          </p>
        </div>
        <Button asChild size="sm">
          <Link to={`/apps?chatAgentId=${encodeURIComponent(agentId)}`}>
            <MessageSquarePlus />
            {t("agentChannelsUi.connect")}
          </Link>
        </Button>
      </div>
      {query.isError && (
        <div role="alert" className="space-y-2 text-sm text-destructive">
          <p>{t("agentChannelsUi.loadFailed")}</p>
          {errorMessage !== null && <p>{errorMessage}</p>}
          <Button type="button" variant="outline" size="sm" disabled={query.isFetching} onClick={() => { void query.refetch(); }}>
            {query.isFetching ? t("common.loading") : t("common.retry")}
          </Button>
        </div>
      )}
      {query.isLoading ? (
        <p className="text-sm text-muted-foreground">{t("agentChannelsUi.loading")}</p>
      ) : query.isError && endpoints.length === 0 ? null : endpoints.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-5">
          <p className="text-sm font-medium">{t("agentChannelsUi.empty")}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(enabled || githubEnabled ? "agentChannelsUi.connectIdentity" : "agentChannelsUi.connectAgentMail")}
          </p>
          <Button asChild className="mt-3" variant="outline" size="sm">
            <Link to="/apps">{t("agentChannelsUi.openConnectors")}</Link>
          </Button>
        </div>
      ) : (
        <div className="divide-y divide-border border-y border-border">
          {endpoints.map((endpoint) => (
            <div
              key={endpoint.id}
              className="flex flex-wrap items-center gap-3 py-4"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">
                  {providerNames[endpoint.provider] ?? endpoint.provider}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {endpoint.botLabel ??
                    endpoint.providerAccountLabel ??
                    t("agentChannelsUi.providerIdentity")}
                </p>
              </div>
              <StatusBadge status={endpoint.status} label={Object.hasOwn(endpointStatusKeys, endpoint.status) ? t(endpointStatusKeys[endpoint.status]) : endpoint.status} />
              <Button asChild size="sm" variant="outline">
                <Link to={`/apps/chat/${endpoint.id}/settings`}>
                  {t("agentChannelsUi.openConnection")} <ExternalLink />
                </Link>
              </Button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
