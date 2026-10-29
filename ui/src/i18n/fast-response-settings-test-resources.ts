// Test only: runtime locale composition remains owned by integration.
import { i18n } from "./index";
import en from "./contributions/fastResponseSettingsUi/en.json";
import zh from "./contributions/fastResponseSettingsUi/zh-CN.json";
import es from "./contributions/fastResponseSettingsUi/es.json";
import ja from "./contributions/fastResponseSettingsUi/ja.json";
export const fastResponseSettingsMessages = { en, "zh-CN": zh, es, ja };
for (const [locale, fastResponseSettingsUi] of Object.entries(fastResponseSettingsMessages)) {
  i18n.addResourceBundle(locale, "translation", { fastResponseSettingsUi }, true, true);
}
export { i18n };
