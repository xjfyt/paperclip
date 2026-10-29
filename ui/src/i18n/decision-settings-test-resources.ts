// Test only: runtime locale composition remains owned by integration.
import { i18n } from "./index";
import en from "./contributions/decisionSettingsUi/en.json";
import zh from "./contributions/decisionSettingsUi/zh-CN.json";
import es from "./contributions/decisionSettingsUi/es.json";
import ja from "./contributions/decisionSettingsUi/ja.json";
export const decisionSettingsMessages = { en, "zh-CN": zh, es, ja };
for (const [locale, decisionSettingsUi] of Object.entries(decisionSettingsMessages)) {
  i18n.addResourceBundle(locale, "translation", { decisionSettingsUi }, true, true);
}
export { i18n };
