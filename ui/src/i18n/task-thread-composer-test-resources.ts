// Test only: integration composes contributions into runtime locales.
import { i18n } from "./index";
import en from "./contributions/taskThreadComposerUi/en.json";
import zh from "./contributions/taskThreadComposerUi/zh-CN.json";
import es from "./contributions/taskThreadComposerUi/es.json";
import ja from "./contributions/taskThreadComposerUi/ja.json";
export const taskThreadComposerMessages = { en, "zh-CN": zh, es, ja };
export { i18n };
for (const [locale, taskThreadComposerUi] of Object.entries(taskThreadComposerMessages)) {
  i18n.addResourceBundle(locale, "translation", { taskThreadComposerUi }, true, true);
}
