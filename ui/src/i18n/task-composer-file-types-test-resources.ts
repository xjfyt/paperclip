// Test only: integration composes contribution files into the runtime locales.
import { i18n } from "./index";
import en from "./contributions/taskComposerFileTypesUi/en.json";
import zh from "./contributions/taskComposerFileTypesUi/zh-CN.json";
import es from "./contributions/taskComposerFileTypesUi/es.json";
import ja from "./contributions/taskComposerFileTypesUi/ja.json";
export const taskComposerFileTypeMessages = { en, "zh-CN": zh, es, ja };
for (const [locale, taskComposerFileTypesUi] of Object.entries(taskComposerFileTypeMessages)) {
  i18n.addResourceBundle(locale, "translation", { taskComposerFileTypesUi }, true, true);
}
