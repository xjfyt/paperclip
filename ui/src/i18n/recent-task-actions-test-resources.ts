// Test only: the integration owner composes this domain into runtime locales.
import { i18n } from "./index";
import en from "./contributions/recentTaskActionsUi/en.json";
import zh from "./contributions/recentTaskActionsUi/zh-CN.json";
import es from "./contributions/recentTaskActionsUi/es.json";
import ja from "./contributions/recentTaskActionsUi/ja.json";
export const recentTaskActionsMessages = { en, "zh-CN": zh, es, ja };
for (const [locale, recentTaskActionsUi] of Object.entries(recentTaskActionsMessages)) {
  i18n.addResourceBundle(locale, "translation", { recentTaskActionsUi }, true, true);
}
