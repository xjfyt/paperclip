// Test only: integration owns runtime locale composition.
import { i18n } from "./index";
import en from "./contributions/taskProtocolInspectorUi/en.json";
import zh from "./contributions/taskProtocolInspectorUi/zh-CN.json";
import ja from "./contributions/taskProtocolInspectorUi/ja.json";
import es from "./contributions/taskProtocolInspectorUi/es.json";
export const taskProtocolInspectorMessages = { en, "zh-CN": zh, ja, es };
for (const [locale, taskProtocolInspectorUi] of Object.entries(taskProtocolInspectorMessages)) {
  i18n.addResourceBundle(locale, "translation", { taskProtocolInspectorUi }, true, true);
}
export { i18n };
