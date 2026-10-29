// Test only: integration composes contributions into runtime locales.
import { i18n } from "./index";
import en from "./contributions/taskRecoveryControlsUi/en.json";
import zh from "./contributions/taskRecoveryControlsUi/zh-CN.json";
import es from "./contributions/taskRecoveryControlsUi/es.json";
import ja from "./contributions/taskRecoveryControlsUi/ja.json";
export const taskRecoveryControlsMessages = { en, "zh-CN": zh, es, ja };
export { i18n };
for (const [locale, taskRecoveryControlsUi] of Object.entries(taskRecoveryControlsMessages)) {
  i18n.addResourceBundle(locale, "translation", { taskRecoveryControlsUi }, true, true);
}
