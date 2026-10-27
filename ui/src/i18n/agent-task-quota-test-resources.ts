// Test only: runtime locale composition remains owned by integration.
import { i18n } from "./index";
import en from "./contributions/agentTaskQuotaUi/en.json";
import zh from "./contributions/agentTaskQuotaUi/zh-CN.json";
import es from "./contributions/agentTaskQuotaUi/es.json";
import ja from "./contributions/agentTaskQuotaUi/ja.json";
import directoryEn from "./contributions/companiesDirectoryUi/en.json";
import directoryZh from "./contributions/companiesDirectoryUi/zh-CN.json";
import directoryEs from "./contributions/companiesDirectoryUi/es.json";
import directoryJa from "./contributions/companiesDirectoryUi/ja.json";
const directoryMessages = { en: directoryEn, "zh-CN": directoryZh, es: directoryEs, ja: directoryJa };
for (const [locale, companiesDirectoryUi] of Object.entries(directoryMessages)) {
  i18n.addResourceBundle(locale, "translation", { companiesDirectoryUi }, true, true);
}
export const agentTaskQuotaMessages = { en, "zh-CN": zh, es, ja };
for (const [locale, agentTaskQuotaUi] of Object.entries(agentTaskQuotaMessages)) {
  i18n.addResourceBundle(locale, "translation", { agentTaskQuotaUi }, true, true);
}
export { i18n };
