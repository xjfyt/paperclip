// Test only: integration composes contribution files into runtime locales.
import { i18n } from "./index";
import en from "./contributions/instructionHistoryUi/en.json";
import zh from "./contributions/instructionHistoryUi/zh-CN.json";
import es from "./contributions/instructionHistoryUi/es.json";
import ja from "./contributions/instructionHistoryUi/ja.json";
export const instructionHistoryMessages = { en, "zh-CN": zh, es, ja };
for (const [locale, instructionHistoryUi] of Object.entries(instructionHistoryMessages)) {
  i18n.addResourceBundle(locale, "translation", { instructionHistoryUi }, true, true);
}
export { i18n };
