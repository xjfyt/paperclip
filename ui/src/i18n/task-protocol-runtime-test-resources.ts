// Test only: integration composes contributions into runtime locales.
import { i18n } from "./index";
import en from "./contributions/taskProtocolRuntimeUi/en.json";
import zh from "./contributions/taskProtocolRuntimeUi/zh-CN.json";
import ja from "./contributions/taskProtocolRuntimeUi/ja.json";
import es from "./contributions/taskProtocolRuntimeUi/es.json";
export const taskProtocolRuntimeMessages = { en, "zh-CN": zh, ja, es };
for (const [locale, taskProtocolRuntimeUi] of Object.entries(taskProtocolRuntimeMessages)) {
  i18n.addResourceBundle(locale, "translation", { taskProtocolRuntimeUi }, true, true);
}
export { i18n };
