import { useTranslation } from "@/i18n";
import { InlineBanner } from "@/components/InlineBanner";
import { webhookUrlWarningReason } from "@/lib/webhook-url-warning";

export function WebhookUrlWarning({ url }: { url: string }) {
  const { t } = useTranslation();
  const reason = webhookUrlWarningReason(url);
  if (!reason) return null;
  return <InlineBanner tone="warning" title={t(`routineTriggerPanelsUi.warning_${reason}_title`)}>
    <div className="space-y-2">
      <p>{t(`routineTriggerPanelsUi.warning_${reason}_message`)}</p>
      <p>{t("routineTriggerPanelsUi.warningHelp")}</p>
      <a className="underline underline-offset-4" href="https://docs.paperclip.ing/reference/deploy/https/" target="_blank" rel="noopener noreferrer">{t("routineTriggerPanelsUi.warningLink")}</a>
    </div>
  </InlineBanner>;
}
