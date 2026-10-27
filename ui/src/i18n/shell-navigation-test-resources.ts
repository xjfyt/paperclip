// Test only: integration composes contribution files into the runtime locales.
import { i18n } from "./index";
import en from "./contributions/shellNavigationUi/en.json";
import zh from "./contributions/shellNavigationUi/zh-CN.json";
import es from "./contributions/shellNavigationUi/es.json";
import ja from "./contributions/shellNavigationUi/ja.json";
export const shellNavigationMessages = { en, "zh-CN": zh, es, ja };
for (const [locale, shellNavigationUi] of Object.entries(shellNavigationMessages)) {
  i18n.addResourceBundle(locale, "translation", { shellNavigationUi }, true, true);
}
export { i18n };
