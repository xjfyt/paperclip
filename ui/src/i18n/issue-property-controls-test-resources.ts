// Test only: integration composes contribution files into the runtime locales.
import { i18n } from "./index";
import en from "./contributions/issuePropertyControlsUi/en.json";
import zh from "./contributions/issuePropertyControlsUi/zh-CN.json";
import es from "./contributions/issuePropertyControlsUi/es.json";
import ja from "./contributions/issuePropertyControlsUi/ja.json";
import propertyEn from "./contributions/propertyLabels/en.json";
import propertyZh from "./contributions/propertyLabels/zh-CN.json";
import propertyEs from "./contributions/propertyLabels/es.json";
import propertyJa from "./contributions/propertyLabels/ja.json";

export const issuePropertyControlsMessages = { en, "zh-CN": zh, es, ja };
for (const [locale, issuePropertyControlsUi] of Object.entries(issuePropertyControlsMessages)) {
  i18n.addResourceBundle(locale, "translation", { issuePropertyControlsUi }, true, true);
}

export const propertyLabelMessages = { en: propertyEn, "zh-CN": propertyZh, es: propertyEs, ja: propertyJa };
for (const [locale, propertyLabels] of Object.entries(propertyLabelMessages)) {
  i18n.addResourceBundle(locale, "translation", { propertyLabels }, true, true);
}
