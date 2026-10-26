// Test only: runtime locale composition belongs to integration.
import "./connection-handoff-test-resources";
import "./connection-access-test-resources";
import { i18n } from "./index";
import en from "./contributions/remoteMcpStatusUi/en.json";
import zh from "./contributions/remoteMcpStatusUi/zh-CN.json";
import es from "./contributions/remoteMcpStatusUi/es.json";
import ja from "./contributions/remoteMcpStatusUi/ja.json";
export const remoteMcpStatusMessages = { en, "zh-CN": zh, es, ja };
for (const [locale, remoteMcpStatusUi] of Object.entries(remoteMcpStatusMessages)) {
  i18n.addResourceBundle(locale, "translation", { remoteMcpStatusUi }, true, true);
}
