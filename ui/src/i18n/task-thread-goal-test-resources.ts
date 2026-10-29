// Test only: integration composes contributions into runtime locales.
import { i18n } from "./index";
import en from "./contributions/taskThreadGoalUi/en.json";
import zh from "./contributions/taskThreadGoalUi/zh-CN.json";
import es from "./contributions/taskThreadGoalUi/es.json";
import ja from "./contributions/taskThreadGoalUi/ja.json";
export const taskThreadGoalMessages = { en, "zh-CN": zh, es, ja };
export { i18n };
for (const [locale, taskThreadGoalUi] of Object.entries(taskThreadGoalMessages)) {
  i18n.addResourceBundle(locale, "translation", { taskThreadGoalUi }, true, true);
}
