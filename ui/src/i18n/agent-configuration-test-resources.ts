// Test only: the integration owner composes this domain into runtime locales.
import { i18n } from "./index";
import en from "./contributions/agentConfigurationUi/en.json";
import zh from "./contributions/agentConfigurationUi/zh-CN.json";
import es from "./contributions/agentConfigurationUi/es.json";
import ja from "./contributions/agentConfigurationUi/ja.json";
export const agentConfigurationMessages = { en, "zh-CN": zh, es, ja };
for (const [locale, agentConfigurationUi] of Object.entries(agentConfigurationMessages)) {
  i18n.addResourceBundle(locale, "translation", { agentConfigurationUi }, true, true);
}
