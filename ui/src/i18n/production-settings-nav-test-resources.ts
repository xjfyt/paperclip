// Test only: integration composes contribution files into the runtime locales.
import { i18n } from "./index";
import en from "./contributions/productionSettingsNavUi/en.json";
import zh from "./contributions/productionSettingsNavUi/zh-CN.json";
import es from "./contributions/productionSettingsNavUi/es.json";
import ja from "./contributions/productionSettingsNavUi/ja.json";
export const productionSettingsNavMessages = { en, "zh-CN": zh, es, ja };
for (const [locale, productionSettingsNavUi] of Object.entries(productionSettingsNavMessages)) {
  i18n.addResourceBundle(locale, "translation", { productionSettingsNavUi }, true, true);
}
export { i18n };
