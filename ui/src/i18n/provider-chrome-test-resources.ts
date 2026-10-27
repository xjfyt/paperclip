import { i18n } from "./index";
import en from "./contributions/providerChromeUi/en.json";
import zh from "./contributions/providerChromeUi/zh-CN.json";
import es from "./contributions/providerChromeUi/es.json";
import ja from "./contributions/providerChromeUi/ja.json";
export const providerChromeMessages = { en, "zh-CN": zh, es, ja };
for (const [locale, providerChromeUi] of Object.entries(providerChromeMessages)) {
  i18n.addResourceBundle(locale, "translation", { providerChromeUi }, true, true);
}
export { i18n };
