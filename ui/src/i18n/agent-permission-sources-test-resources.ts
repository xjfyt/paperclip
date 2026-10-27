// Test only: integration composes contribution files into the runtime locales.
import { i18n } from "./index";
import en from "./contributions/agentPermissionSourcesUi/en.json";
import zh from "./contributions/agentPermissionSourcesUi/zh-CN.json";
import es from "./contributions/agentPermissionSourcesUi/es.json";
import ja from "./contributions/agentPermissionSourcesUi/ja.json";
export const agentPermissionSourcesMessages = { en, "zh-CN": zh, es, ja };
for (const [locale, agentPermissionSourcesUi] of Object.entries(agentPermissionSourcesMessages)) {
  i18n.addResourceBundle(locale, "translation", { agentPermissionSourcesUi }, true, true);
}
