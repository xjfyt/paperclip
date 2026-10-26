// Test only: integration composes contribution files into the runtime locales.
import { i18n } from "./index";
import en from "./contributions/issueMonitorUi/en.json";
import zh from "./contributions/issueMonitorUi/zh-CN.json";
import es from "./contributions/issueMonitorUi/es.json";
import ja from "./contributions/issueMonitorUi/ja.json";
export const issueMonitorMessages = { en, "zh-CN": zh, es, ja };
for (const [locale, issueMonitorUi] of Object.entries(issueMonitorMessages)) {
  i18n.addResourceBundle(locale, "translation", { issueMonitorUi }, true, true);
}
