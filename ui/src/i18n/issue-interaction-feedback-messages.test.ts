import { describe, expect, it } from "vitest";
import { validateLocaleMessages } from "./locale-validation";
import { issueInteractionFeedbackMessages } from "./issue-interaction-feedback-test-resources";

describe("issue interaction feedback contribution contracts", () => {
  it.each(Object.entries(issueInteractionFeedbackMessages))("aligns %s keys, placeholders and safe text", (_locale, messages) => {
    expect(validateLocaleMessages(messages, issueInteractionFeedbackMessages.en)).toEqual([]);
    for (const value of Object.values(messages)) {
      expect(value.trim()).not.toBe("");
      expect(value).not.toMatch(/<\/?[A-Za-z]|javascript\s*:|data\s*:/i);
    }
  });
});
