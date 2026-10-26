// Test only: runtime locale composition belongs to integration.
import { i18n } from "./index";
import en from "./contributions/connectionCompletionUi/en.json";
import zh from "./contributions/connectionCompletionUi/zh-CN.json";
import es from "./contributions/connectionCompletionUi/es.json";
import ja from "./contributions/connectionCompletionUi/ja.json";
export const connectionCompletionMessages = { en, "zh-CN": zh, es, ja };
for (const [locale, connectionCompletionUi] of Object.entries(connectionCompletionMessages)) {
  i18n.addResourceBundle(locale, "translation", { connectionCompletionUi }, true, true);
}
