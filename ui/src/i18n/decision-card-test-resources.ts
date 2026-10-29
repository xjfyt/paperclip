// Test only: root integration owns generated runtime locale composition.
import { i18n } from "./index";
import en from "./contributions/decisionCardUi/en.json";
import zh from "./contributions/decisionCardUi/zh-CN.json";
import es from "./contributions/decisionCardUi/es.json";
import ja from "./contributions/decisionCardUi/ja.json";
export const decisionCardMessages = { en, "zh-CN": zh, es, ja };
for (const [locale, decisionCardUi] of Object.entries(decisionCardMessages)) {
  i18n.addResourceBundle(locale, "translation", { decisionCardUi }, true, true);
}
export { i18n };
