import { describe, expect, it } from "vitest";
import { i18n } from "./index";
import { validateLocaleMessages } from "./locale-validation";
import { issueDetailMessages } from "./issue-detail-test-resources";

describe("issue detail literal contribution contracts", () => {
  it.each(Object.entries(issueDetailMessages))("aligns %s complete templates and zero/single/plural counts", (locale, messages) => {
    expect(validateLocaleMessages(messages, issueDetailMessages.en)).toEqual([]);
    const t = i18n.getFixedT(locale);
    for (const count of [0, 1, 3]) {
      const suffix = count === 1 && ["en", "es"].includes(locale) ? "one" : "other";
      expect(t("issueDetailUi.taskCount", { count })).toBe(messages[`taskCount_${suffix}`].replace("{{count}}", String(count)));
      expect(t("issueDetailUi.costRuntime", { duration: "1m 23s", count })).toBe(messages[`costRuntime_${suffix}`].replace("{{count}}", String(count)).replace("{{duration}}", "1m 23s"));
    }
    for (const value of Object.values(messages)) expect(value).not.toMatch(/<\/?[A-Za-z]|javascript\s*:|data\s*:/i);
  });
});
