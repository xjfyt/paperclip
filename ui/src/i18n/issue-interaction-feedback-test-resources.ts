// Test only: integration composes contribution files into the runtime locales.
import { i18n } from "./index";
import en from "./contributions/issueInteractionFeedbackUi/en.json";
import zh from "./contributions/issueInteractionFeedbackUi/zh-CN.json";
import es from "./contributions/issueInteractionFeedbackUi/es.json";
import ja from "./contributions/issueInteractionFeedbackUi/ja.json";
export const issueInteractionFeedbackMessages = { en, "zh-CN": zh, es, ja };
for (const [locale, issueInteractionFeedbackUi] of Object.entries(issueInteractionFeedbackMessages)) {
  i18n.addResourceBundle(locale, "translation", { issueInteractionFeedbackUi }, true, true);
}
