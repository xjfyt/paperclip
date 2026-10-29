// Test only: integration composes contributions into runtime locales.
import { i18n } from "./index";
import en from "./contributions/taskThreadActivityUi/en.json";
import zh from "./contributions/taskThreadActivityUi/zh-CN.json";
import es from "./contributions/taskThreadActivityUi/es.json";
import ja from "./contributions/taskThreadActivityUi/ja.json";
export const taskThreadActivityMessages = { en, "zh-CN": zh, es, ja };
export { i18n };
for (const [locale, taskThreadActivityUi] of Object.entries(taskThreadActivityMessages)) {
  i18n.addResourceBundle(locale, "translation", { taskThreadActivityUi }, true, true);
}
