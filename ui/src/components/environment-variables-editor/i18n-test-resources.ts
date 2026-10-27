// Test only: runtime locale composition is owned by the integration pass.
import { i18n } from "@/i18n";
import en from "@/i18n/contributions/environmentEditorUi/en.json";
import zh from "@/i18n/contributions/environmentEditorUi/zh-CN.json";
import es from "@/i18n/contributions/environmentEditorUi/es.json";
import ja from "@/i18n/contributions/environmentEditorUi/ja.json";
export const environmentEditorMessages = { en, "zh-CN": zh, es, ja };
for (const [locale, environmentEditorUi] of Object.entries(environmentEditorMessages)) {
  i18n.addResourceBundle(locale, "translation", { environmentEditorUi }, true, true);
}
