// Test only: integration composes contribution files into the runtime locales.
import { i18n } from "./index";
import en from "./contributions/composerAssigneeUi/en.json";
import zh from "./contributions/composerAssigneeUi/zh-CN.json";
import es from "./contributions/composerAssigneeUi/es.json";
import ja from "./contributions/composerAssigneeUi/ja.json";
export const composerAssigneeMessages = { en, "zh-CN": zh, es, ja };
for (const [locale, composerAssigneeUi] of Object.entries(composerAssigneeMessages)) {
  i18n.addResourceBundle(locale, "translation", { composerAssigneeUi }, true, true);
}
export { i18n };
