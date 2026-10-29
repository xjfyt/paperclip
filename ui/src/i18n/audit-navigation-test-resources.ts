// Test only: integration composes contribution files into runtime locales.
import { i18n } from "./index";
import en from "./contributions/auditNavigationUi/en.json";
import zh from "./contributions/auditNavigationUi/zh-CN.json";
import es from "./contributions/auditNavigationUi/es.json";
import ja from "./contributions/auditNavigationUi/ja.json";
export const auditNavigationMessages = { en, "zh-CN": zh, es, ja };
for (const [locale, auditNavigationUi] of Object.entries(auditNavigationMessages)) {
  i18n.addResourceBundle(locale, "translation", { auditNavigationUi }, true, true);
}
export { i18n };
