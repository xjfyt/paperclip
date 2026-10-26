// Test only: the integration owner composes this domain into runtime locales.
import { i18n } from "./index";
import en from "./contributions/agentSetupSharedUi/en.json";
import zh from "./contributions/agentSetupSharedUi/zh-CN.json";
import es from "./contributions/agentSetupSharedUi/es.json";
import ja from "./contributions/agentSetupSharedUi/ja.json";
export const agentSetupSharedMessages = { en, "zh-CN": zh, es, ja };
for (const [locale, agentSetupSharedUi] of Object.entries(agentSetupSharedMessages)) {
  i18n.addResourceBundle(locale, "translation", { agentSetupSharedUi }, true, true);
}
