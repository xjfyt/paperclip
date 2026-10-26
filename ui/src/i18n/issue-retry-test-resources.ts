import "./issue-monitor-test-resources";
// Test only: integration composes contributions into the runtime locales.
import { i18n } from "./index";
import en from "./contributions/issueRetryUi/en.json";
import zh from "./contributions/issueRetryUi/zh-CN.json";
import es from "./contributions/issueRetryUi/es.json";
import ja from "./contributions/issueRetryUi/ja.json";
export const issueRetryMessages = { en, "zh-CN": zh, es, ja };
for (const [locale, issueRetryUi] of Object.entries(issueRetryMessages)) {
  i18n.addResourceBundle(locale, "translation", { issueRetryUi }, true, true);
}
