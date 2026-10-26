// Test only: runtime locale composition belongs to integration.
import "./connection-oauth-test-resources";
import { i18n } from "./index";
import en from "./contributions/connectionHandoffUi/en.json";
import zh from "./contributions/connectionHandoffUi/zh-CN.json";
import es from "./contributions/connectionHandoffUi/es.json";
import ja from "./contributions/connectionHandoffUi/ja.json";
export const connectionHandoffMessages = { en, "zh-CN": zh, es, ja };
for (const [locale, connectionHandoffUi] of Object.entries(connectionHandoffMessages)) {
  i18n.addResourceBundle(locale, "translation", { connectionHandoffUi }, true, true);
}
