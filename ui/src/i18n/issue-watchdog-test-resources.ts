// Test only: integration composes contribution files into the runtime locales.
import { i18n } from "./index";
import en from "./contributions/issueWatchdogUi/en.json";
import zh from "./contributions/issueWatchdogUi/zh-CN.json";
import es from "./contributions/issueWatchdogUi/es.json";
import ja from "./contributions/issueWatchdogUi/ja.json";
export const issueWatchdogMessages = { en, "zh-CN": zh, es, ja };
for (const [locale, issueWatchdogUi] of Object.entries(issueWatchdogMessages)) {
  i18n.addResourceBundle(locale, "translation", { issueWatchdogUi }, true, true);
}
