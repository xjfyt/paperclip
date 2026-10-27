// Test only: integration composes contribution files into runtime locales.
import { i18n } from "./index";
import en from "./contributions/issueQueuedDeliveryUi/en.json";
import zh from "./contributions/issueQueuedDeliveryUi/zh-CN.json";
import ja from "./contributions/issueQueuedDeliveryUi/ja.json";
import es from "./contributions/issueQueuedDeliveryUi/es.json";
export const issueQueuedDeliveryMessages = { en, "zh-CN": zh, ja, es };
for (const [locale, issueQueuedDeliveryUi] of Object.entries(issueQueuedDeliveryMessages)) {
  i18n.addResourceBundle(locale, "translation", { issueQueuedDeliveryUi }, true, true);
}
