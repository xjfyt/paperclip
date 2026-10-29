import "./document-test-resources";
import { i18n } from "./index";
import en from "./contributions/artifactUi/en.json";
import zh from "./contributions/artifactUi/zh-CN.json";
import es from "./contributions/artifactUi/es.json";
import ja from "./contributions/artifactUi/ja.json";
export const artifactMessages = { en, "zh-CN": zh, es, ja };
for (const [locale, artifactUi] of Object.entries(artifactMessages)) i18n.addResourceBundle(locale, "translation", { artifactUi }, true, true);
