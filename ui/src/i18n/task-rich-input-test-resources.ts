// Test only: runtime locale composition remains owned by integration.
import { i18n } from "./question-form-test-resources";
import en from "./contributions/taskRichInputUi/en.json";
import zh from "./contributions/taskRichInputUi/zh-CN.json";
import es from "./contributions/taskRichInputUi/es.json";
import ja from "./contributions/taskRichInputUi/ja.json";
export const taskRichInputMessages = { en, "zh-CN": zh, es, ja };
for (const [locale, taskRichInputUi] of Object.entries(taskRichInputMessages)) {
  i18n.addResourceBundle(locale, "translation", { taskRichInputUi }, true, true);
}
export { i18n };
