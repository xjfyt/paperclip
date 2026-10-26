import { describe, expect, it } from "vitest";
import { validateLocaleMessages } from "./locale-validation";
import { issueWatchdogMessages } from "./issue-watchdog-test-resources";

describe("task watchdog contribution contracts", () => {
  it.each(Object.entries(issueWatchdogMessages))("aligns keys, placeholders and safe text in %s", (_locale, messages) => {
    expect(validateLocaleMessages(messages, issueWatchdogMessages.en)).toEqual([]);
    for (const value of Object.values(messages)) {
      expect(value.trim()).not.toBe("");
      expect(value).not.toMatch(/<\/?[A-Za-z]|javascript\s*:|data\s*:/i);
    }
  });
});
