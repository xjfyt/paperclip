// Test only: integration composes contributions into runtime locales.
import { i18n } from "./index";
import en from "./contributions/taskThreadQueueUi/en.json";
import zh from "./contributions/taskThreadQueueUi/zh-CN.json";
import es from "./contributions/taskThreadQueueUi/es.json";
import ja from "./contributions/taskThreadQueueUi/ja.json";
export const taskThreadQueueMessages = { en, "zh-CN": zh, es, ja };
export { i18n };
for (const [locale, taskThreadQueueUi] of Object.entries(taskThreadQueueMessages)) {
  i18n.addResourceBundle(locale, "translation", { taskThreadQueueUi }, true, true);
}
