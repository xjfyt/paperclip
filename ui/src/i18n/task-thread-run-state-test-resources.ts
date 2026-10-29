// Test only: integration composes contributions into runtime locales.
import { i18n } from "./index";
import en from "./contributions/taskThreadRunStateUi/en.json";
import zh from "./contributions/taskThreadRunStateUi/zh-CN.json";
import es from "./contributions/taskThreadRunStateUi/es.json";
import ja from "./contributions/taskThreadRunStateUi/ja.json";
export const taskThreadRunStateMessages = { en, "zh-CN": zh, es, ja };
export { i18n };
for (const [locale, taskThreadRunStateUi] of Object.entries(taskThreadRunStateMessages)) {
  i18n.addResourceBundle(locale, "translation", { taskThreadRunStateUi }, true, true);
}
