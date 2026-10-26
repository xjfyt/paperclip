// Test only: connection contributions are composed into runtime locales at integration.
import { i18n } from "./index";
import en from "./contributions/agentSetupConnectionUi/en.json";
import zh from "./contributions/agentSetupConnectionUi/zh-CN.json";
import es from "./contributions/agentSetupConnectionUi/es.json";
import ja from "./contributions/agentSetupConnectionUi/ja.json";
export const agentSetupConnectionMessages = { en, "zh-CN": zh, es, ja };
for (const [locale, agentSetupConnectionUi] of Object.entries(agentSetupConnectionMessages)) {
  i18n.addResourceBundle(locale, "translation", { agentSetupConnectionUi }, true, true);
}
