import "./file-viewer-test-resources";
import { i18n } from "./index";
import en from "./contributions/workspaceBrowserUi/en.json";
import zh from "./contributions/workspaceBrowserUi/zh-CN.json";
import es from "./contributions/workspaceBrowserUi/es.json";
import ja from "./contributions/workspaceBrowserUi/ja.json";
export const workspaceBrowserMessages = { en, "zh-CN": zh, es, ja };
for (const [locale, workspaceBrowserUi] of Object.entries(workspaceBrowserMessages)) i18n.addResourceBundle(locale, "translation", { workspaceBrowserUi }, true, true);
