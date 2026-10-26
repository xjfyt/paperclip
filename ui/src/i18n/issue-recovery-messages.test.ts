import { describe, expect, it } from "vitest";
import { validateLocaleMessages } from "./locale-validation";
import { issueRecoveryMessages } from "./issue-recovery-test-resources";

describe("recovery card contribution contracts", () => {
  it.each(Object.entries(issueRecoveryMessages))("aligns %s keys, placeholders and safe text", (_locale, messages) => {
    expect(validateLocaleMessages(messages, issueRecoveryMessages.en)).toEqual([]);
    for (const value of Object.values(messages)) {
      expect(value.trim()).not.toBe("");
      expect(value).not.toMatch(/<\/?[A-Za-z]|javascript\s*:|data\s*:/i);
    }
  });
});
