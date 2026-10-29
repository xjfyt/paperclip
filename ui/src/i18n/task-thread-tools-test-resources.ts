// Test only: integration composes contributions into runtime locales.
import { i18n } from "./index";
import en from "./contributions/taskThreadToolsUi/en.json";
import zh from "./contributions/taskThreadToolsUi/zh-CN.json";
import es from "./contributions/taskThreadToolsUi/es.json";
import ja from "./contributions/taskThreadToolsUi/ja.json";
export const taskThreadToolMessages = { en, "zh-CN": zh, es, ja };
export { i18n };
for (const [locale, taskThreadToolsUi] of Object.entries(taskThreadToolMessages)) {
  i18n.addResourceBundle(locale, "translation", { taskThreadToolsUi }, true, true);
}
