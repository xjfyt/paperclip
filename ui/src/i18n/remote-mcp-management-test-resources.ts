// Test only: runtime locale composition belongs to integration.
import "./remote-mcp-form-test-resources";
import { i18n } from "./index";
import en from "./contributions/remoteMcpManagementUi/en.json";
import zh from "./contributions/remoteMcpManagementUi/zh-CN.json";
import es from "./contributions/remoteMcpManagementUi/es.json";
import ja from "./contributions/remoteMcpManagementUi/ja.json";
export const remoteMcpManagementMessages = { en, "zh-CN": zh, es, ja };
for (const [locale, remoteMcpManagementUi] of Object.entries(remoteMcpManagementMessages)) {
  i18n.addResourceBundle(locale, "translation", { remoteMcpManagementUi }, true, true);
}
