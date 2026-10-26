// Test only: integration composes contribution files into the runtime locales.
import { i18n } from "./index";
import en from "./contributions/issueModelUi/en.json";
import zh from "./contributions/issueModelUi/zh-CN.json";
import es from "./contributions/issueModelUi/es.json";
import ja from "./contributions/issueModelUi/ja.json";
export const issueModelMessages = { en, "zh-CN": zh, es, ja };
for (const [locale, issueModelUi] of Object.entries(issueModelMessages)) {
  i18n.addResourceBundle(locale, "translation", { issueModelUi }, true, true);
}
