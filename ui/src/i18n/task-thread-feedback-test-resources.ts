// Test only: integration composes contributions into runtime locales.
import { i18n } from "./index";
import en from "./contributions/taskThreadFeedbackUi/en.json";
import zh from "./contributions/taskThreadFeedbackUi/zh-CN.json";
import es from "./contributions/taskThreadFeedbackUi/es.json";
import ja from "./contributions/taskThreadFeedbackUi/ja.json";
export const taskThreadFeedbackMessages = { en, "zh-CN": zh, es, ja };
export { i18n };
for (const [locale, taskThreadFeedbackUi] of Object.entries(taskThreadFeedbackMessages)) {
  i18n.addResourceBundle(locale, "translation", { taskThreadFeedbackUi }, true, true);
}
