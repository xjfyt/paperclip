// Test only: integration composes contribution files into the runtime locales.
import { i18n } from "./index";
import en from "./contributions/agentDetailLabelsUi/en.json";
import zh from "./contributions/agentDetailLabelsUi/zh-CN.json";
import es from "./contributions/agentDetailLabelsUi/es.json";
import ja from "./contributions/agentDetailLabelsUi/ja.json";
export const agentDetailLabelsMessages = { en, "zh-CN": zh, es, ja };
for (const [locale, agentDetailLabelsUi] of Object.entries(agentDetailLabelsMessages)) {
  i18n.addResourceBundle(locale, "translation", { agentDetailLabelsUi }, true, true);
}
export { i18n };
