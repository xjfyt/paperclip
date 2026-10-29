// Test only: integration composes contributions into runtime locales.
import "./task-thread-feedback-test-resources";
import { i18n } from "./index";
import en from "./contributions/interactionAudienceUi/en.json";
import zh from "./contributions/interactionAudienceUi/zh-CN.json";
import es from "./contributions/interactionAudienceUi/es.json";
import ja from "./contributions/interactionAudienceUi/ja.json";
export const interactionAudienceMessages = { en, "zh-CN": zh, es, ja };
export { i18n };
for (const [locale, interactionAudienceUi] of Object.entries(interactionAudienceMessages)) {
  i18n.addResourceBundle(locale, "translation", { interactionAudienceUi }, true, true);
}
