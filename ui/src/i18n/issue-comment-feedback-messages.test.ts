import { describe, expect, it } from "vitest";
import { validateLocaleMessages } from "./locale-validation";
import { issueCommentFeedbackMessages } from "./issue-comment-feedback-test-resources";

describe("issue comment feedback contribution contracts", () => {
  it.each(Object.entries(issueCommentFeedbackMessages))("aligns %s keys, placeholders and safe text", (_locale, messages) => {
    expect(validateLocaleMessages(messages, issueCommentFeedbackMessages.en)).toEqual([]);
    for (const value of Object.values(messages)) {
      expect(value.trim()).not.toBe("");
      expect(value).not.toMatch(/<\/?[A-Za-z]|javascript\s*:|data\s*:/i);
    }
  });
});
