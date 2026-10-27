// Test only: integration composes contribution files into the runtime locales.
import { i18n } from "./index";
import en from "./contributions/issueFeedbackUi/en.json";
import zh from "./contributions/issueFeedbackUi/zh-CN.json";
import es from "./contributions/issueFeedbackUi/es.json";
import ja from "./contributions/issueFeedbackUi/ja.json";
export const issueFeedbackMessages = { en, "zh-CN": zh, es, ja };
for (const [locale, issueFeedbackUi] of Object.entries(issueFeedbackMessages)) {
  i18n.addResourceBundle(locale, "translation", { issueFeedbackUi }, true, true);
}
