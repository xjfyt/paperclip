// Test only: integration composes contribution files into the runtime locales.
import { i18n } from "./index";
import "./review-policy-test-resources";
import en from "./contributions/issueActivityUi/en.json";
import zh from "./contributions/issueActivityUi/zh-CN.json";
import es from "./contributions/issueActivityUi/es.json";
import ja from "./contributions/issueActivityUi/ja.json";
export const issueActivityMessages = { en, "zh-CN": zh, es, ja };
for (const [locale, issueActivityUi] of Object.entries(issueActivityMessages)) {
  i18n.addResourceBundle(locale, "translation", { issueActivityUi }, true, true);
}
export { i18n };
