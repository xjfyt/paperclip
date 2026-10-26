// Test only: integration composes contribution files into the runtime locales.
import { i18n } from "./index";
import en from "./contributions/issuePropertyControlsUi/en.json";
import zh from "./contributions/issuePropertyControlsUi/zh-CN.json";
import es from "./contributions/issuePropertyControlsUi/es.json";
import ja from "./contributions/issuePropertyControlsUi/ja.json";
export const issuePropertyControlsMessages = { en, "zh-CN": zh, es, ja };
for (const [locale, issuePropertyControlsUi] of Object.entries(issuePropertyControlsMessages)) {
  i18n.addResourceBundle(locale, "translation", { issuePropertyControlsUi }, true, true);
}
