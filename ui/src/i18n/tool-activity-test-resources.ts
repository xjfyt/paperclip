// Test only: integration composes contribution files into the runtime locales.
import { i18n } from "./index";
import en from "./contributions/toolActivityUi/en.json";
import zh from "./contributions/toolActivityUi/zh-CN.json";
import es from "./contributions/toolActivityUi/es.json";
import ja from "./contributions/toolActivityUi/ja.json";
export const toolActivityMessages = { en, "zh-CN": zh, es, ja };
for (const [locale, toolActivityUi] of Object.entries(toolActivityMessages)) {
  i18n.addResourceBundle(locale, "translation", { toolActivityUi }, true, true);
}
