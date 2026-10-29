// Test only: integration composes contribution files into runtime locales.
import { i18n } from "./index";
import en from "./contributions/agentSkillsUi/en.json";
import zh from "./contributions/agentSkillsUi/zh-CN.json";
import es from "./contributions/agentSkillsUi/es.json";
import ja from "./contributions/agentSkillsUi/ja.json";
export const agentSkillsMessages = { en, "zh-CN": zh, es, ja };
for (const [locale, agentSkillsUi] of Object.entries(agentSkillsMessages)) {
  i18n.addResourceBundle(locale, "translation", { agentSkillsUi }, true, true);
}
export { i18n };
