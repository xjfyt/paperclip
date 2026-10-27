// Test only: runtime locale composition belongs to the integration owner.
import { i18n } from "./index";
import en from "./contributions/apiErrorUi/en.json";
import zh from "./contributions/apiErrorUi/zh-CN.json";
import es from "./contributions/apiErrorUi/es.json";
import ja from "./contributions/apiErrorUi/ja.json";
export const apiErrorMessages = { en, "zh-CN": zh, es, ja };
for (const [locale, apiErrorUi] of Object.entries(apiErrorMessages)) {
  i18n.addResourceBundle(locale, "translation", { apiErrorUi }, true, true);
}
export { i18n };
