// Test only: integration composes contributions into runtime locales.
import "./task-recovery-controls-test-resources";
import { i18n } from "./index";
import en from "./contributions/taskBrowserPanelUi/en.json";
import zh from "./contributions/taskBrowserPanelUi/zh-CN.json";
import es from "./contributions/taskBrowserPanelUi/es.json";
import ja from "./contributions/taskBrowserPanelUi/ja.json";
export const taskBrowserPanelMessages = { en, "zh-CN": zh, es, ja };
export { i18n };
for (const [locale, taskBrowserPanelUi] of Object.entries(taskBrowserPanelMessages)) {
  i18n.addResourceBundle(locale, "translation", { taskBrowserPanelUi }, true, true);
}
