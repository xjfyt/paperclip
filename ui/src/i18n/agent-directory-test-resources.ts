// Test only: runtime locale composition remains owned by integration.
import { i18n } from "./agent-task-quota-test-resources";
import en from "./contributions/agentDirectoryUi/en.json";
import zh from "./contributions/agentDirectoryUi/zh-CN.json";
import es from "./contributions/agentDirectoryUi/es.json";
import ja from "./contributions/agentDirectoryUi/ja.json";
export const agentDirectoryMessages = { en, "zh-CN": zh, es, ja };
for (const [locale, agentDirectoryUi] of Object.entries(agentDirectoryMessages)) {
  i18n.addResourceBundle(locale, "translation", { agentDirectoryUi }, true, true);
}
