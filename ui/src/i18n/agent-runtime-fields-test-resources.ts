// Test only: the integration owner composes this domain into runtime locales.
import { i18n } from "./index";
import en from "./contributions/agentRuntimeFieldsUi/en.json";
import zh from "./contributions/agentRuntimeFieldsUi/zh-CN.json";
import es from "./contributions/agentRuntimeFieldsUi/es.json";
import ja from "./contributions/agentRuntimeFieldsUi/ja.json";
export const agentRuntimeFieldsMessages = { en, "zh-CN": zh, es, ja };
for (const [locale, agentRuntimeFieldsUi] of Object.entries(agentRuntimeFieldsMessages)) {
  i18n.addResourceBundle(locale, "translation", { agentRuntimeFieldsUi }, true, true);
}
