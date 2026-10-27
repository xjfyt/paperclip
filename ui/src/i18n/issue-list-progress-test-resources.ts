// Test only: integration composes contribution files into the runtime locales.
import { i18n } from "./index";
import en from "./contributions/issueListProgressUi/en.json";
import zh from "./contributions/issueListProgressUi/zh-CN.json";
import es from "./contributions/issueListProgressUi/es.json";
import ja from "./contributions/issueListProgressUi/ja.json";
export const issueListProgressMessages = { en, "zh-CN": zh, es, ja };
for (const [locale, issueListProgressUi] of Object.entries(issueListProgressMessages)) {
  i18n.addResourceBundle(locale, "translation", { issueListProgressUi }, true, true);
}
export { i18n };
