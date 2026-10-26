// Test only: integration composes contribution files into the runtime locales.
import { i18n } from "./index";
import en from "./contributions/issueRecoveryUi/en.json";
import zh from "./contributions/issueRecoveryUi/zh-CN.json";
import es from "./contributions/issueRecoveryUi/es.json";
import ja from "./contributions/issueRecoveryUi/ja.json";
export const issueRecoveryMessages = { en, "zh-CN": zh, es, ja };
for (const [locale, issueRecoveryUi] of Object.entries(issueRecoveryMessages)) {
  i18n.addResourceBundle(locale, "translation", { issueRecoveryUi }, true, true);
}
