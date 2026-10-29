// Test only: runtime locale composition remains owned by integration.
import { i18n } from "./index";
import en from "./contributions/costHistoryUi/en.json";
import zh from "./contributions/costHistoryUi/zh-CN.json";
import es from "./contributions/costHistoryUi/es.json";
import ja from "./contributions/costHistoryUi/ja.json";
export const costHistoryMessages = { en, "zh-CN": zh, es, ja };
for (const [locale, costHistoryUi] of Object.entries(costHistoryMessages)) {
  i18n.addResourceBundle(locale, "translation", { costHistoryUi }, true, true);
}
export { i18n };
