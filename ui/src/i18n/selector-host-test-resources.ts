// Test only: integration composes contribution files into the runtime locales.
import { i18n } from "./index";
import en from "./contributions/selectorHostUi/en.json";
import zh from "./contributions/selectorHostUi/zh-CN.json";
import es from "./contributions/selectorHostUi/es.json";
import ja from "./contributions/selectorHostUi/ja.json";
export const selectorHostMessages = { en, "zh-CN": zh, es, ja };
for (const [locale, selectorHostUi] of Object.entries(selectorHostMessages)) {
  i18n.addResourceBundle(locale, "translation", { selectorHostUi }, true, true);
}
export { i18n };
