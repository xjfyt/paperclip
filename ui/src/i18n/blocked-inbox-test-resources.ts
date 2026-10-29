import { i18n } from "./index";
import en from "./contributions/blockedInboxUi/en.json";
import zhCN from "./contributions/blockedInboxUi/zh-CN.json";
import es from "./contributions/blockedInboxUi/es.json";
import ja from "./contributions/blockedInboxUi/ja.json";
export const blockedInboxMessages = { en, "zh-CN": zhCN, es, ja };
for (const [locale, blockedInboxUi] of Object.entries(blockedInboxMessages)) {
  i18n.addResourceBundle(locale, "translation", { blockedInboxUi }, true, true);
}
export { i18n };
