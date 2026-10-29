// Test only: integration composes contribution files into runtime locales.
import "./issue-activity-test-resources";
import { i18n } from "./index";
import en from "./contributions/auditEventUi/en.json";
import zh from "./contributions/auditEventUi/zh-CN.json";
import es from "./contributions/auditEventUi/es.json";
import ja from "./contributions/auditEventUi/ja.json";
export const auditEventMessages = { en, "zh-CN": zh, es, ja };
for (const [locale, auditEventUi] of Object.entries(auditEventMessages)) {
  i18n.addResourceBundle(locale, "translation", { auditEventUi }, true, true);
}
export { i18n };
