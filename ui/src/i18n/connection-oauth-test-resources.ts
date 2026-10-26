// Test only: runtime locale composition belongs to integration.
import { i18n } from "./index";
import en from "./contributions/connectionOAuthUi/en.json";
import zh from "./contributions/connectionOAuthUi/zh-CN.json";
import es from "./contributions/connectionOAuthUi/es.json";
import ja from "./contributions/connectionOAuthUi/ja.json";
export const connectionOAuthMessages = { en, "zh-CN": zh, es, ja };
for (const [locale, connectionOAuthUi] of Object.entries(connectionOAuthMessages)) {
  i18n.addResourceBundle(locale, "translation", { connectionOAuthUi }, true, true);
}
