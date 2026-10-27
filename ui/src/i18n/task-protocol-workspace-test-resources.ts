// Test only: integration composes contributions into runtime locales.
import { i18n } from "./index";
import en from "./contributions/taskProtocolWorkspaceUi/en.json";
import zh from "./contributions/taskProtocolWorkspaceUi/zh-CN.json";
import ja from "./contributions/taskProtocolWorkspaceUi/ja.json";
import es from "./contributions/taskProtocolWorkspaceUi/es.json";
export const taskProtocolWorkspaceMessages = { en, "zh-CN": zh, ja, es };
for (const [locale, taskProtocolWorkspaceUi] of Object.entries(taskProtocolWorkspaceMessages)) {
  i18n.addResourceBundle(locale, "translation", { taskProtocolWorkspaceUi }, true, true);
}
export { i18n };
