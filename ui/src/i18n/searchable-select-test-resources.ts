// Test only: integration composes contributions into runtime locales.
import { i18n } from "./index";
import en from "./contributions/searchableSelectUi/en.json";
import zh from "./contributions/searchableSelectUi/zh-CN.json";
import es from "./contributions/searchableSelectUi/es.json";
import ja from "./contributions/searchableSelectUi/ja.json";
export const searchableSelectMessages = { en, "zh-CN": zh, es, ja };
export { i18n };
for (const [locale, searchableSelectUi] of Object.entries(searchableSelectMessages)) {
  i18n.addResourceBundle(locale, "translation", { searchableSelectUi }, true, true);
}
