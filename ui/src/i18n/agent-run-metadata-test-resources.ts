// Test only: runtime locale composition remains owned by integration.
import { i18n } from "./index";
import en from "./contributions/agentRunMetadataUi/en.json";
import zh from "./contributions/agentRunMetadataUi/zh-CN.json";
import es from "./contributions/agentRunMetadataUi/es.json";
import ja from "./contributions/agentRunMetadataUi/ja.json";
for (const [locale, agentRunMetadataUi] of Object.entries({ en, "zh-CN": zh, es, ja })) {
  i18n.addResourceBundle(locale, "translation", { agentRunMetadataUi }, true, true);
}
