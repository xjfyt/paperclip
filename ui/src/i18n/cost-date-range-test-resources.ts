// Test only: runtime locale composition remains owned by integration.
import { i18n } from "./provider-quota-test-resources";
import en from "./contributions/costDateRangeUi/en.json";
import zh from "./contributions/costDateRangeUi/zh-CN.json";
import es from "./contributions/costDateRangeUi/es.json";
import ja from "./contributions/costDateRangeUi/ja.json";
export const costDateRangeMessages = { en, "zh-CN": zh, es, ja };
for (const [locale, costDateRangeUi] of Object.entries(costDateRangeMessages)) {
  i18n.addResourceBundle(locale, "translation", { costDateRangeUi }, true, true);
}
