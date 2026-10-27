// Test only: integration composes contribution files into the runtime locales.
import { i18n } from "./index";
import en from "./contributions/completedActivityUi/en.json";
import zh from "./contributions/completedActivityUi/zh-CN.json";
import es from "./contributions/completedActivityUi/es.json";
import ja from "./contributions/completedActivityUi/ja.json";
export const completedActivityMessages = { en, "zh-CN": zh, es, ja };
for (const [locale, completedActivityUi] of Object.entries(completedActivityMessages)) {
  i18n.addResourceBundle(locale, "translation", { completedActivityUi: { ...completedActivityUi } }, true, true);
}
export { i18n };
