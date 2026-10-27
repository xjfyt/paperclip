// Test only: integration composes contribution files into the runtime locales.
import { i18n } from "./index";
import en from "./contributions/issueCommentFeedbackUi/en.json";
import zh from "./contributions/issueCommentFeedbackUi/zh-CN.json";
import es from "./contributions/issueCommentFeedbackUi/es.json";
import ja from "./contributions/issueCommentFeedbackUi/ja.json";
export const issueCommentFeedbackMessages = { en, "zh-CN": zh, es, ja };
for (const [locale, issueCommentFeedbackUi] of Object.entries(issueCommentFeedbackMessages)) {
  i18n.addResourceBundle(locale, "translation", { issueCommentFeedbackUi }, true, true);
}
