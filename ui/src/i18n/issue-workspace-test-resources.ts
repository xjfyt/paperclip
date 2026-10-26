// Test only: integration composes contribution files into the runtime locales.
import { i18n } from "./index";
import en from "./contributions/issueWorkspaceUi/en.json";
import zh from "./contributions/issueWorkspaceUi/zh-CN.json";
import es from "./contributions/issueWorkspaceUi/es.json";
import ja from "./contributions/issueWorkspaceUi/ja.json";
export const issueWorkspaceMessages = { en, "zh-CN": zh, es, ja };
for (const [locale, issueWorkspaceUi] of Object.entries(issueWorkspaceMessages)) {
  i18n.addResourceBundle(locale, "translation", { issueWorkspaceUi }, true, true);
}
