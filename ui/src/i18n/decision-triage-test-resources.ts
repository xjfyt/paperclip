import "./attention-row-test-resources";
import { i18n } from "./index";
import en from "./contributions/decisionTriageUi/en.json";
import zh from "./contributions/decisionTriageUi/zh-CN.json";
import es from "./contributions/decisionTriageUi/es.json";
import ja from "./contributions/decisionTriageUi/ja.json";
export const decisionTriageMessages = { en, "zh-CN": zh, es, ja };
for (const [locale, decisionTriageUi] of Object.entries(decisionTriageMessages)) i18n.addResourceBundle(locale, "translation", { decisionTriageUi }, true, true);
export { i18n };
