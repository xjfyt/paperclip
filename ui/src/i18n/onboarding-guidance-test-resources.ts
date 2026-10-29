// Test only: integration composes contribution files into runtime locales.
import { i18n } from "./index";
import en from "./contributions/onboardingGuidanceUi/en.json";
import zh from "./contributions/onboardingGuidanceUi/zh-CN.json";
import es from "./contributions/onboardingGuidanceUi/es.json";
import ja from "./contributions/onboardingGuidanceUi/ja.json";
export const onboardingGuidanceMessages = { en, "zh-CN": zh, es, ja };
for (const [locale, onboardingGuidanceUi] of Object.entries(onboardingGuidanceMessages)) {
  i18n.addResourceBundle(locale, "translation", { onboardingGuidanceUi }, true, true);
}
export { i18n };
