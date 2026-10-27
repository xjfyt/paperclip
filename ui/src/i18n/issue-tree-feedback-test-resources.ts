// Test only: integration composes contribution files into runtime locales.
import { i18n } from "./index";
import en from "./contributions/issueTreeFeedbackUi/en.json";
import zh from "./contributions/issueTreeFeedbackUi/zh-CN.json";
import ja from "./contributions/issueTreeFeedbackUi/ja.json";
import es from "./contributions/issueTreeFeedbackUi/es.json";
export const issueTreeFeedbackMessages = { en, "zh-CN": zh, ja, es };
for (const [locale, issueTreeFeedbackUi] of Object.entries(issueTreeFeedbackMessages)) {
  i18n.addResourceBundle(locale, "translation", { issueTreeFeedbackUi }, true, true);
}
