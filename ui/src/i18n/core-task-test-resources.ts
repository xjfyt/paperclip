// Test only: integration composes contribution files into the runtime locales.
import { i18n } from "./index";
import en from "./contributions/coreTaskUi/en.json";
import zh from "./contributions/coreTaskUi/zh-CN.json";
import es from "./contributions/coreTaskUi/es.json";
import ja from "./contributions/coreTaskUi/ja.json";
export const coreTaskMessages = { en, "zh-CN": zh, es, ja };
for (const [locale, coreTaskUi] of Object.entries(coreTaskMessages)) {
  i18n.addResourceBundle(locale, "translation", { coreTaskUi }, true, true);
}
export { i18n };
