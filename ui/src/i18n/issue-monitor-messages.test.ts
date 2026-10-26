import { describe, expect, it } from "vitest";
import { validateLocaleMessages } from "./locale-validation";
import { issueMonitorMessages } from "./issue-monitor-test-resources";

describe("task monitor contribution contracts", () => {
  it.each(Object.entries(issueMonitorMessages))("aligns keys, placeholders and safe text in %s", (_locale, messages) => {
    expect(validateLocaleMessages(messages, issueMonitorMessages.en)).toEqual([]);
    for (const value of Object.values(messages)) {
      expect(value.trim()).not.toBe("");
      expect(value).not.toMatch(/<\/?[A-Za-z]|javascript\s*:|data\s*:/i);
    }
  });
});
