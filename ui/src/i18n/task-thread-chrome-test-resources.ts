import "./task-thread-notice-test-resources";
// Test only: integration composes contributions into runtime locales.
import { i18n } from "./index";
import en from "./contributions/taskThreadChromeUi/en.json";
import zh from "./contributions/taskThreadChromeUi/zh-CN.json";
import es from "./contributions/taskThreadChromeUi/es.json";
import ja from "./contributions/taskThreadChromeUi/ja.json";
export const taskThreadChromeMessages = { en, "zh-CN": zh, es, ja };
export { i18n };
for (const [locale, taskThreadChromeUi] of Object.entries(taskThreadChromeMessages)) {
  i18n.addResourceBundle(locale, "translation", { taskThreadChromeUi }, true, true);
}
