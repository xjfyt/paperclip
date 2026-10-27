// Test only: integration composes contribution files into runtime locales.
import { i18n } from "./index";
import en from "./contributions/issueTreeExecutionUi/en.json";
import zh from "./contributions/issueTreeExecutionUi/zh-CN.json";
import ja from "./contributions/issueTreeExecutionUi/ja.json";
import es from "./contributions/issueTreeExecutionUi/es.json";
export const issueTreeExecutionMessages = { en, "zh-CN": zh, ja, es };
for (const [locale, issueTreeExecutionUi] of Object.entries(issueTreeExecutionMessages)) {
  i18n.addResourceBundle(locale, "translation", { issueTreeExecutionUi }, true, true);
}
