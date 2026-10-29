// Test only: composed into the runtime locales by the integration owner.
import { i18n } from "./index";
import en from "./contributions/agentTrustUi/en.json";
import zh from "./contributions/agentTrustUi/zh-CN.json";
import es from "./contributions/agentTrustUi/es.json";
import ja from "./contributions/agentTrustUi/ja.json";
export const agentTrustMessages = { en, "zh-CN": zh, es, ja };
for (const [locale, agentTrustUi] of Object.entries(agentTrustMessages)) {
  i18n.addResourceBundle(locale, "translation", { agentTrustUi }, true, true);
}
