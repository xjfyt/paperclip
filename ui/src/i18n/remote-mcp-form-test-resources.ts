// Test only: runtime locale composition belongs to integration.
import "./remote-mcp-status-test-resources";
import { i18n } from "./index";
import en from "./contributions/remoteMcpFormUi/en.json";
import zh from "./contributions/remoteMcpFormUi/zh-CN.json";
import es from "./contributions/remoteMcpFormUi/es.json";
import ja from "./contributions/remoteMcpFormUi/ja.json";
export const remoteMcpFormMessages = { en, "zh-CN": zh, es, ja };
for (const [locale, remoteMcpFormUi] of Object.entries(remoteMcpFormMessages)) {
  i18n.addResourceBundle(locale, "translation", { remoteMcpFormUi }, true, true);
}
