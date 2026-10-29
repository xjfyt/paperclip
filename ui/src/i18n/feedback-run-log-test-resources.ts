// Test only: integration owns generated locale composition.
import { i18n } from "./index";
import en from "./contributions/feedbackRunLogUi/en.json";
import zh from "./contributions/feedbackRunLogUi/zh-CN.json";
import es from "./contributions/feedbackRunLogUi/es.json";
import ja from "./contributions/feedbackRunLogUi/ja.json";
export const runLogMessages = { en, "zh-CN": zh, es, ja };
for (const [locale, feedbackRunLogUi] of Object.entries(runLogMessages)) i18n.addResourceBundle(locale, "translation", { feedbackRunLogUi }, true, true);
export { i18n };
