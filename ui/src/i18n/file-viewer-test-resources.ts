import "./document-test-resources";
import { i18n } from "./index";
import en from "./contributions/fileViewerUi/en.json";
import zh from "./contributions/fileViewerUi/zh-CN.json";
import es from "./contributions/fileViewerUi/es.json";
import ja from "./contributions/fileViewerUi/ja.json";
export const fileViewerMessages = { en, "zh-CN": zh, es, ja };
for (const [locale, fileViewerUi] of Object.entries(fileViewerMessages)) i18n.addResourceBundle(locale, "translation", { fileViewerUi }, true, true);
