// Test only: integration composes contribution files into the runtime locales.
import { i18n } from "./index";
import en from "./contributions/issueDetailUi/en.json";
import zh from "./contributions/issueDetailUi/zh-CN.json";
import ja from "./contributions/issueDetailUi/ja.json";
import es from "./contributions/issueDetailUi/es.json";
export const issueDetailMessages = { en, "zh-CN": zh, ja, es };
for (const [locale, issueDetailUi] of Object.entries(issueDetailMessages)) {
  i18n.addResourceBundle(locale, "translation", { issueDetailUi }, true, true);
}
