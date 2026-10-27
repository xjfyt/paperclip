import { expect, it } from "vitest";
import { i18n } from "./index";
import { validateLocaleMessages } from "./locale-validation";
import { issueTreeFeedbackMessages } from "./issue-tree-feedback-test-resources";
it.each(Object.entries(issueTreeFeedbackMessages))("validates complete tree feedback templates for %s", (locale, messages) => {
  expect(validateLocaleMessages(messages, issueTreeFeedbackMessages.en)).toEqual([]);
  for (const count of [0, 1, 3]) {
    const suffix = count === 1 && ["en", "es"].includes(locale) ? "one" : "other";
    expect(i18n.getFixedT(locale)("issueTreeFeedbackUi.wakeFailed", { count, message: "raw {{count}} <tag>" }))
      .toBe(messages[`wakeFailed_${suffix}`].replace("{{count}}", String(count)).replace("{{message}}", "raw {{count}} <tag>"));
  }
});
