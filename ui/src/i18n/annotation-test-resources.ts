import "./document-test-resources";
import { i18n } from "./index";
import en from "./contributions/annotationUi/en.json";
import zh from "./contributions/annotationUi/zh-CN.json";
import es from "./contributions/annotationUi/es.json";
import ja from "./contributions/annotationUi/ja.json";
export const annotationMessages = { en, "zh-CN": zh, es, ja };
for (const [locale, annotationUi] of Object.entries(annotationMessages)) i18n.addResourceBundle(locale, "translation", { annotationUi }, true, true);
