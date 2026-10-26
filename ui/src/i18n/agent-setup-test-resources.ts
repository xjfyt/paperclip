import "./connection-access-test-resources";
import "./agent-setup-login-test-resources";
import "./agent-setup-connection-test-resources";
import "./agent-setup-shared-test-resources";
// Test only: the integration owner composes these contributions into runtime locales.
import { i18n } from "./index";
import en from "./contributions/agentSetupUi/en.json";
import zh from "./contributions/agentSetupUi/zh-CN.json";
import es from "./contributions/agentSetupUi/es.json";
import ja from "./contributions/agentSetupUi/ja.json";
export const agentSetupMessages = { en, "zh-CN": zh, es, ja };
for (const [locale, agentSetupUi] of Object.entries(agentSetupMessages)) {
  i18n.addResourceBundle(locale, "translation", { agentSetupUi }, true, true);
}
