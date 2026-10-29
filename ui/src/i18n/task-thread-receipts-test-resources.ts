// Test only: integration composes contributions into runtime locales.
import { i18n } from "./index";
import en from "./contributions/taskThreadReceiptsUi/en.json";
import zh from "./contributions/taskThreadReceiptsUi/zh-CN.json";
import es from "./contributions/taskThreadReceiptsUi/es.json";
import ja from "./contributions/taskThreadReceiptsUi/ja.json";
export const taskThreadReceiptMessages = { en, "zh-CN": zh, es, ja };
export { i18n };
for (const [locale, taskThreadReceiptsUi] of Object.entries(taskThreadReceiptMessages)) {
  i18n.addResourceBundle(locale, "translation", { taskThreadReceiptsUi }, true, true);
}
