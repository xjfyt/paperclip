// Test only: login contributions are composed into runtime locales at integration.
import { i18n } from "./index";
import en from "./contributions/agentSetupLoginUi/en.json";
import zh from "./contributions/agentSetupLoginUi/zh-CN.json";
import es from "./contributions/agentSetupLoginUi/es.json";
import ja from "./contributions/agentSetupLoginUi/ja.json";
export const agentSetupLoginMessages = { en, "zh-CN": zh, es, ja };
for (const [locale, agentSetupLoginUi] of Object.entries(agentSetupLoginMessages)) {
  i18n.addResourceBundle(locale, "translation", { agentSetupLoginUi }, true, true);
}
