// Test only: integration composes contributions into runtime locales.
import "./task-thread-chrome-test-resources";
import { i18n } from "./index";
import en from "./contributions/taskThreadContextUi/en.json";
import zh from "./contributions/taskThreadContextUi/zh-CN.json";
import es from "./contributions/taskThreadContextUi/es.json";
import ja from "./contributions/taskThreadContextUi/ja.json";
export const taskThreadContextMessages = { en, "zh-CN": zh, es, ja };
export { i18n };
for (const [locale, taskThreadContextUi] of Object.entries(taskThreadContextMessages)) {
  i18n.addResourceBundle(locale, "translation", { taskThreadContextUi }, true, true);
}
