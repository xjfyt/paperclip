// Test only: integration composes contribution files into the runtime locales.
import { i18n } from "./index";
import en from "./contributions/taskComposerErrorsUi/en.json";
import zh from "./contributions/taskComposerErrorsUi/zh-CN.json";
import es from "./contributions/taskComposerErrorsUi/es.json";
import ja from "./contributions/taskComposerErrorsUi/ja.json";
export const taskComposerErrorMessages = { en, "zh-CN": zh, es, ja };
for (const [locale, taskComposerErrorsUi] of Object.entries(taskComposerErrorMessages)) {
  i18n.addResourceBundle(locale, "translation", { taskComposerErrorsUi }, true, true);
}
