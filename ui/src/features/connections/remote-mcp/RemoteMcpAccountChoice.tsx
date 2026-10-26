import { useTranslation } from "@/i18n";
import type { LocalizedUiMessage } from "@/lib/localized-ui-error";
import { Button } from "@/components/ui/button";
import { InlineBanner } from "@/components/InlineBanner";
import { ConnectionChoiceList } from "../ConnectionChoiceList";

/** Shared presentation for account reuse, including the requested external app. */
export function RemoteMcpAccountChoice({
  providerName,
  upstreamServiceName,
  connections,
  pendingId,
  error,
  onSelect,
  onCancel,
  onConnectNew,
}: {
  providerName: string;
  upstreamServiceName?: string;
  connections: { id: string; name: string }[];
  pendingId?: string | null;
  error?: LocalizedUiMessage | null;
  onSelect: (id: string) => void;
  onCancel?: () => void;
  onConnectNew: () => void;
}) {
  const { t } = useTranslation();
  const errorText = typeof error === "string" ? error : error ? t(error.key) : null;
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold">
          {upstreamServiceName
            ? t("remoteMcpStatusUi.connectThrough", { app: upstreamServiceName, provider: providerName })
            : t("connectionOAuthUi.headerConnect", { serverName: providerName })}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("remoteMcpStatusUi.reuseHelp")}
        </p>
      </div>
      {upstreamServiceName && (
        <InlineBanner compact>
          {t("remoteMcpStatusUi.externalAccountHelp", { provider: providerName, app: upstreamServiceName })}
        </InlineBanner>
      )}
      <ConnectionChoiceList
        choices={connections.map((connection) => ({
          ...connection,
          description: t("remoteMcpStatusUi.accountAvailable"),
        }))}
        pendingId={pendingId}
        onSelect={onSelect}
      />
      {errorText && (
        <p role="alert" className="text-sm text-destructive">
          {errorText}
        </p>
      )}
      <div className="flex items-center justify-between gap-3">
        <Button
          variant="ghost"
          disabled={Boolean(pendingId)}
          onClick={onCancel}
        >
          {t("common.cancel")}
        </Button>
        <Button disabled={Boolean(pendingId)} onClick={onConnectNew}>
          {t("remoteMcpStatusUi.connectNew")}
        </Button>
      </div>
    </div>
  );
}
