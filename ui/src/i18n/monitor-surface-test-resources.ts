import "./issue-monitor-test-resources";
// Test only: integration composes contribution files into the runtime locales.
import { i18n } from "./index";
import en from "./contributions/monitorSurfaceUi/en.json";
import zh from "./contributions/monitorSurfaceUi/zh-CN.json";
import es from "./contributions/monitorSurfaceUi/es.json";
import ja from "./contributions/monitorSurfaceUi/ja.json";
export const monitorSurfaceMessages = { en, "zh-CN": zh, es, ja };
for (const [locale, monitorSurfaceUi] of Object.entries(monitorSurfaceMessages)) {
  i18n.addResourceBundle(locale, "translation", { monitorSurfaceUi }, true, true);
}
