// Test only: integration composes contribution files into runtime locales.
import { i18n } from "./index";
import en from "./contributions/auditRunsUi/en.json";
import zh from "./contributions/auditRunsUi/zh-CN.json";
import es from "./contributions/auditRunsUi/es.json";
import ja from "./contributions/auditRunsUi/ja.json";
export const auditRunsMessages = { en, "zh-CN": zh, es, ja };
for (const [locale, auditRunsUi] of Object.entries(auditRunsMessages)) {
  i18n.addResourceBundle(locale, "translation", { auditRunsUi }, true, true);
}
export { i18n };
