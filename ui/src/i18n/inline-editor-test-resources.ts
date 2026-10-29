// Test only: integration composes contributions into runtime locales.
import { i18n } from "./index";
import en from "./contributions/inlineEditorUi/en.json";
import zh from "./contributions/inlineEditorUi/zh-CN.json";
import es from "./contributions/inlineEditorUi/es.json";
import ja from "./contributions/inlineEditorUi/ja.json";
export const inlineEditorMessages = { en, "zh-CN": zh, es, ja };
export { i18n };
for (const [locale, inlineEditorUi] of Object.entries(inlineEditorMessages)) {
  i18n.addResourceBundle(locale, "translation", { inlineEditorUi }, true, true);
}
