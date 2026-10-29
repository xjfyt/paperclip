// Test only: composed into the runtime locales by the integration owner.
import { i18n } from "./index";
import en from "./contributions/agentChannelsUi/en.json";
import zh from "./contributions/agentChannelsUi/zh-CN.json";
import es from "./contributions/agentChannelsUi/es.json";
import ja from "./contributions/agentChannelsUi/ja.json";
export const agentChannelsMessages = { en, "zh-CN": zh, es, ja };
for (const [locale, agentChannelsUi] of Object.entries(agentChannelsMessages)) {
  i18n.addResourceBundle(locale, "translation", { agentChannelsUi }, true, true);
}
