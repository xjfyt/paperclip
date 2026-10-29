// Test only: integration composes contributions into runtime locales.
import { i18n } from "./index";
import en from "./contributions/taskThreadNoticeUi/en.json";
import zh from "./contributions/taskThreadNoticeUi/zh-CN.json";
import es from "./contributions/taskThreadNoticeUi/es.json";
import ja from "./contributions/taskThreadNoticeUi/ja.json";
export const taskThreadNoticeMessages = { en, "zh-CN": zh, es, ja };
export { i18n };
for (const [locale, taskThreadNoticeUi] of Object.entries(taskThreadNoticeMessages)) {
  i18n.addResourceBundle(locale, "translation", { taskThreadNoticeUi }, true, true);
}
