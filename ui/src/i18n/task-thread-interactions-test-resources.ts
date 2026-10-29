// Test only: integration composes contributions into runtime locales.
import "./task-thread-receipts-test-resources";
import { i18n } from "./index";
import en from "./contributions/taskThreadInteractionsUi/en.json";
import zh from "./contributions/taskThreadInteractionsUi/zh-CN.json";
import es from "./contributions/taskThreadInteractionsUi/es.json";
import ja from "./contributions/taskThreadInteractionsUi/ja.json";
export const taskThreadInteractionMessages = { en, "zh-CN": zh, es, ja };
export { i18n };
for (const [locale, taskThreadInteractionsUi] of Object.entries(taskThreadInteractionMessages)) {
  i18n.addResourceBundle(locale, "translation", { taskThreadInteractionsUi }, true, true);
}
