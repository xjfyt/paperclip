// Test only: integration composes contribution files into the runtime locales.
import { i18n } from "./index";
import en from "./contributions/companySettingsGeneralUi/en.json";
import zh from "./contributions/companySettingsGeneralUi/zh-CN.json";
import es from "./contributions/companySettingsGeneralUi/es.json";
import ja from "./contributions/companySettingsGeneralUi/ja.json";
export const companySettingsGeneralMessages = { en, "zh-CN": zh, es, ja };
for (const [locale, companySettingsGeneralUi] of Object.entries(companySettingsGeneralMessages)) {
  i18n.addResourceBundle(locale, "translation", { companySettingsGeneralUi }, true, true);
}
export { i18n };
