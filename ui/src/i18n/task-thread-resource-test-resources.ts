// Test only: integration composes contributions into runtime locales.
import { i18n } from "./index";
import en from "./contributions/taskThreadResourceUi/en.json";
import zh from "./contributions/taskThreadResourceUi/zh-CN.json";
import ja from "./contributions/taskThreadResourceUi/ja.json";
import es from "./contributions/taskThreadResourceUi/es.json";
export const taskThreadResourceMessages = { en, "zh-CN": zh, ja, es };
for (const [locale, taskThreadResourceUi] of Object.entries(taskThreadResourceMessages)) {
  i18n.addResourceBundle(locale, "translation", { taskThreadResourceUi }, true, true);
}
