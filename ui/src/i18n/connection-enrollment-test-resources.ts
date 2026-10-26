// Test only: runtime locale composition belongs to integration.
import "./connection-handoff-test-resources";
import { i18n } from "./index";
import en from "./contributions/connectionEnrollmentUi/en.json";
import zh from "./contributions/connectionEnrollmentUi/zh-CN.json";
import es from "./contributions/connectionEnrollmentUi/es.json";
import ja from "./contributions/connectionEnrollmentUi/ja.json";
export const connectionEnrollmentMessages = { en, "zh-CN": zh, es, ja };
for (const [locale, connectionEnrollmentUi] of Object.entries(connectionEnrollmentMessages)) {
  i18n.addResourceBundle(locale, "translation", { connectionEnrollmentUi }, true, true);
}
