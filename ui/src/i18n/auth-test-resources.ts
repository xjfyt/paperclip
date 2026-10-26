// Test only: generated runtime locales are composed by the integration owner.
import { i18n } from "./index";
import en from "./contributions/auth/en.json";
import zh from "./contributions/auth/zh-CN.json";
import es from "./contributions/auth/es.json";
import ja from "./contributions/auth/ja.json";
for (const [locale, auth] of Object.entries({ en, "zh-CN": zh, es, ja })) {
  i18n.addResourceBundle(locale, "translation", { auth }, true, true);
}
