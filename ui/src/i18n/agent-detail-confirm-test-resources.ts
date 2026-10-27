// Test only: integration composes contribution files into the runtime locales.
import { i18n } from "./index";
import en from "./contributions/agentDetailConfirmUi/en.json";
import zh from "./contributions/agentDetailConfirmUi/zh-CN.json";
import es from "./contributions/agentDetailConfirmUi/es.json";
import ja from "./contributions/agentDetailConfirmUi/ja.json";
export const agentDetailConfirmMessages = { en, "zh-CN": zh, es, ja };
for (const [locale, agentDetailConfirmUi] of Object.entries(agentDetailConfirmMessages)) {
  i18n.addResourceBundle(locale, "translation", { agentDetailConfirmUi }, true, true);
}
