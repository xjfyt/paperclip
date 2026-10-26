// Test only: this domain is composed into the runtime locales at integration.
import { i18n } from "./index";
import en from "./contributions/connectionAccessUi/en.json";
import zh from "./contributions/connectionAccessUi/zh-CN.json";
import es from "./contributions/connectionAccessUi/es.json";
import ja from "./contributions/connectionAccessUi/ja.json";
export const connectionAccessMessages = { en, "zh-CN": zh, es, ja };
for (const [locale, connectionAccessUi] of Object.entries(connectionAccessMessages)) {
  i18n.addResourceBundle(locale, "translation", { connectionAccessUi }, true, true);
}
