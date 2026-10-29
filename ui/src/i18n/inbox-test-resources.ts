import "./blocked-inbox-test-resources";
import { i18n } from "./index";
import en from "./contributions/inboxUi/en.json";
import zhCN from "./contributions/inboxUi/zh-CN.json";
import es from "./contributions/inboxUi/es.json";
import ja from "./contributions/inboxUi/ja.json";
export const inboxMessages = { en, "zh-CN": zhCN, es, ja };
for (const [locale, inboxUi] of Object.entries(inboxMessages)) i18n.addResourceBundle(locale, "translation", { inboxUi }, true, true);
export { i18n };
