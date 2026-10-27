// Test only: integration composes contribution files into runtime locales.
import { i18n } from "./index";
import en from "./contributions/issueListControlsUi/en.json";
import zh from "./contributions/issueListControlsUi/zh-CN.json";
import ja from "./contributions/issueListControlsUi/ja.json";
import es from "./contributions/issueListControlsUi/es.json";
export const issueListControlsMessages = { en, "zh-CN": zh, ja, es };
for (const [locale, issueListControlsUi] of Object.entries(issueListControlsMessages)) {
  i18n.addResourceBundle(locale, "translation", { issueListControlsUi }, true, true);
}
