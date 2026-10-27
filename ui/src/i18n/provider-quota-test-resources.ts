// Test only: runtime locale composition remains owned by integration.
import { i18n } from "./agent-task-quota-test-resources";
import en from "./contributions/providerQuotaUi/en.json";
import zh from "./contributions/providerQuotaUi/zh-CN.json";
import es from "./contributions/providerQuotaUi/es.json";
import ja from "./contributions/providerQuotaUi/ja.json";
export const providerQuotaMessages = { en, "zh-CN": zh, es, ja };
for (const [locale, providerQuotaUi] of Object.entries(providerQuotaMessages)) {
  i18n.addResourceBundle(locale, "translation", { providerQuotaUi }, true, true);
}
export { i18n, agentTaskQuotaMessages } from "./agent-task-quota-test-resources";
