// Test only: integration composes contribution files into the runtime locales.
import { i18n } from "./index";
import en from "./contributions/composerModelUi/en.json";
import zh from "./contributions/composerModelUi/zh-CN.json";
import es from "./contributions/composerModelUi/es.json";
import ja from "./contributions/composerModelUi/ja.json";
export const composerModelMessages = { en, "zh-CN": zh, es, ja };
for (const [locale, composerModelUi] of Object.entries(composerModelMessages)) {
  i18n.addResourceBundle(locale, "translation", { composerModelUi }, true, true);
}
export { i18n };
