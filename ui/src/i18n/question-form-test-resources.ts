// Test only: runtime locale composition remains owned by integration.
import { i18n } from "./index";
import en from "./contributions/questionFormUi/en.json";
import zh from "./contributions/questionFormUi/zh-CN.json";
import es from "./contributions/questionFormUi/es.json";
import ja from "./contributions/questionFormUi/ja.json";
export const questionFormMessages = { en, "zh-CN": zh, es, ja };
for (const [locale, questionFormUi] of Object.entries(questionFormMessages)) {
  i18n.addResourceBundle(locale, "translation", { questionFormUi }, true, true);
}
export { i18n };
