// Test only: runtime locale composition remains owned by integration.
import { i18n } from "./index";
import en from "./contributions/managementUi/en.json";
import zh from "./contributions/managementUi/zh-CN.json";
import es from "./contributions/managementUi/es.json";
import ja from "./contributions/managementUi/ja.json";
export const managementMessages = { en, "zh-CN": zh, es, ja };
for (const [locale, managementUi] of Object.entries(managementMessages)) {
  i18n.addResourceBundle(locale, "translation", { managementUi }, true, true);
}
export { i18n };
