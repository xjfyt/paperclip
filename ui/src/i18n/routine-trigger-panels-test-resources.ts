// Test-only composition; runtime locale files are generated during integration.
import "./remote-mcp-form-test-resources";
import { i18n } from "./index";
import en from "./contributions/routineTriggerPanelsUi/en.json";
import zh from "./contributions/routineTriggerPanelsUi/zh-CN.json";
import es from "./contributions/routineTriggerPanelsUi/es.json";
import ja from "./contributions/routineTriggerPanelsUi/ja.json";
import promptEn from "./contributions/agentSetupPromptUi/en.json";
import promptZh from "./contributions/agentSetupPromptUi/zh-CN.json";
import promptEs from "./contributions/agentSetupPromptUi/es.json";
import promptJa from "./contributions/agentSetupPromptUi/ja.json";
export const routineTriggerPanelMessages = { en, "zh-CN": zh, es, ja };
export const agentSetupPromptMessages = { en: promptEn, "zh-CN": promptZh, es: promptEs, ja: promptJa };
for (const locale of ["en", "zh-CN", "es", "ja"] as const) {
  i18n.addResourceBundle(locale, "translation", {
    routineTriggerPanelsUi: routineTriggerPanelMessages[locale],
    agentSetupPromptUi: agentSetupPromptMessages[locale],
  }, true, true);
}
