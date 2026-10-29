// Test only: root integration owns generated runtime locale composition.
import { i18n } from "./index";
import en from "./contributions/decisionDeskUi/en.json";
import zh from "./contributions/decisionDeskUi/zh-CN.json";
import es from "./contributions/decisionDeskUi/es.json";
import ja from "./contributions/decisionDeskUi/ja.json";
export const decisionDeskMessages = { en, "zh-CN": zh, es, ja };
for (const [locale, decisionDeskUi] of Object.entries(decisionDeskMessages)) {
  i18n.addResourceBundle(locale, "translation", { decisionDeskUi }, true, true);
}
export { i18n };
