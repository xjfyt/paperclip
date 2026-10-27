import { i18n } from "./index";
import en from "./contributions/reviewPolicyUi/en.json";
import zh from "./contributions/reviewPolicyUi/zh-CN.json";
import es from "./contributions/reviewPolicyUi/es.json";
import ja from "./contributions/reviewPolicyUi/ja.json";
export const reviewPolicyMessages = { en, "zh-CN": zh, es, ja };
for (const [locale, reviewPolicyUi] of Object.entries(reviewPolicyMessages)) {
  i18n.addResourceBundle(locale, "translation", { reviewPolicyUi }, true, true);
}
export { i18n };
