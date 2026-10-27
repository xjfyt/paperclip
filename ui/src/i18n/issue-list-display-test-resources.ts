// Test only: integration composes contribution files into runtime locales.
import { i18n } from "./index";
import en from "./contributions/issueListDisplayUi/en.json";
import zh from "./contributions/issueListDisplayUi/zh-CN.json";
import ja from "./contributions/issueListDisplayUi/ja.json";
import es from "./contributions/issueListDisplayUi/es.json";
export const issueListDisplayMessages = { en, "zh-CN": zh, ja, es };
for (const [locale, issueListDisplayUi] of Object.entries(issueListDisplayMessages)) {
  i18n.addResourceBundle(locale, "translation", { issueListDisplayUi }, true, true);
}
