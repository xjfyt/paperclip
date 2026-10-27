import { describe, expect, it } from "vitest";
import { validateLocaleMessages } from "./locale-validation";
import { issueFeedbackMessages } from "./issue-feedback-test-resources";

describe("issue mutation feedback contribution contracts", () => {
  it.each(Object.entries(issueFeedbackMessages))("aligns %s keys, placeholders and safe text", (_locale, messages) => {
    expect(validateLocaleMessages(messages, issueFeedbackMessages.en)).toEqual([]);
    for (const value of Object.values(messages)) {
      expect(value.trim()).not.toBe("");
      expect(value).not.toMatch(/<\/?[A-Za-z]|javascript\s*:|data\s*:/i);
    }
  });
});
