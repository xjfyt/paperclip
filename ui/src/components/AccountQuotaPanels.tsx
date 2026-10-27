import { t, useTranslation } from "@/i18n";
import type { ProviderQuotaResult } from "@paperclipai/shared";
import { formatDateTime } from "../lib/utils";
import { QuotaBar } from "./QuotaBar";

export function AccountQuotaPanels({
  accounts,
  failed,
}: {
  accounts: ProviderQuotaResult[];
  failed?: boolean;
}) {
  useTranslation();
  return (
    <div className="space-y-4">
      {accounts.map((account) => (
        <section
          className="space-y-2"
          key={account.accountKey ?? account.provider}
        >
          <p className="text-sm font-medium">
            {account.accountLabel ?? t("agentTaskQuotaUi.subscriptionAccount")}
          </p>
          {(failed || !account.ok) && (
            <p className="text-sm text-muted-foreground">
              {account.errorFamily === "credentials_unavailable"
                ? t("agentTaskQuotaUi.reconnectQuota")
                : t(account.windows.length > 0 ? "agentTaskQuotaUi.lastQuota" : "agentTaskQuotaUi.unavailableQuota")}
            </p>
          )}
          {account.windows.map((window, index) => window.usedPercent == null ? (
            <div key={`${window.label}:${index}`} className="space-y-1 text-sm">
              <div className="flex justify-between gap-3">
                <span>{window.label}</span>
                <span className="font-mono text-muted-foreground">{window.valueLabel ?? t("agentTaskQuotaUi.usageNotReported")}</span>
              </div>
              {window.resetsAt && <p className="text-xs font-mono text-muted-foreground">{t("agentTaskQuotaUi.resetsAt", { time: formatDateTime(window.resetsAt) })}</p>}
            </div>
          ) : (
            <QuotaBar
              key={`${window.label}:${index}`}
              className="font-mono"
              label={window.label}
              percentUsed={window.usedPercent}
              leftLabel={
                window.valueLabel ??
                (window.usedPercent === null
                  ? t("agentTaskQuotaUi.usageNotReported")
                  : t("agentTaskQuotaUi.usedPercent", { percent: window.usedPercent }))
              }
              rightLabel={
                window.resetsAt
                  ? t("agentTaskQuotaUi.resetsAt", { time: formatDateTime(window.resetsAt) })
                  : undefined
              }
            />
          ))}
          {account.capturedAt && (
            <p className="text-xs font-mono text-muted-foreground">
              {t("agentTaskQuotaUi.lastChecked", { time: formatDateTime(account.capturedAt) })}
            </p>
          )}
        </section>
      ))}
    </div>
  );
}
