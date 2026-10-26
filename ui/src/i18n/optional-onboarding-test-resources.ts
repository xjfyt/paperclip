// Test only: contribution files are composed into runtime locales at integration.
import { i18n } from "./index";
import en from "./contributions/optionalOnboarding/en.json";
import zh from "./contributions/optionalOnboarding/zh-CN.json";
import es from "./contributions/optionalOnboarding/es.json";
import ja from "./contributions/optionalOnboarding/ja.json";
for (const [locale, optionalOnboarding] of Object.entries({ en, "zh-CN": zh, es, ja })) {
  i18n.addResourceBundle(locale, "translation", { optionalOnboarding }, true, true);
}
