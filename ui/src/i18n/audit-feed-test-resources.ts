// Test only: integration composes contribution files into runtime locales.
import { i18n } from "./index";
import en from "./contributions/auditFeedUi/en.json";
import zh from "./contributions/auditFeedUi/zh-CN.json";
import es from "./contributions/auditFeedUi/es.json";
import ja from "./contributions/auditFeedUi/ja.json";
export const auditFeedMessages = { en, "zh-CN": zh, es, ja };
for (const [locale, auditFeedUi] of Object.entries(auditFeedMessages)) {
  i18n.addResourceBundle(locale, "translation", { auditFeedUi }, true, true);
}
export { i18n };
