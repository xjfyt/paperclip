// Test only: the integration owner composes this domain into runtime locales.
import { i18n } from "../../i18n";
import en from "../../i18n/contributions/runTranscriptUi/en.json";
import zh from "../../i18n/contributions/runTranscriptUi/zh-CN.json";
import es from "../../i18n/contributions/runTranscriptUi/es.json";
import ja from "../../i18n/contributions/runTranscriptUi/ja.json";
export const runTranscriptMessages = { en, "zh-CN": zh, es, ja };
for (const [locale, runTranscriptUi] of Object.entries(runTranscriptMessages)) {
  i18n.addResourceBundle(locale, "translation", { runTranscriptUi }, true, true);
}
