// Test only: integration composes contribution files into runtime locales.
import { i18n } from "./index";
import en from "./contributions/approvalDetailUi/en.json";
import zh from "./contributions/approvalDetailUi/zh-CN.json";
import ja from "./contributions/approvalDetailUi/ja.json";
import es from "./contributions/approvalDetailUi/es.json";
export const approvalDetailMessages = { en, "zh-CN": zh, ja, es };
for (const [locale, approvalDetailUi] of Object.entries(approvalDetailMessages)) {
  i18n.addResourceBundle(locale, "translation", { approvalDetailUi }, true, true);
}
