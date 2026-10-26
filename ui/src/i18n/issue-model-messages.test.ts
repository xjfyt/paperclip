import { describe, expect, it } from "vitest";
import { validateLocaleMessages } from "./locale-validation";
import { issueModelMessages } from "./issue-model-test-resources";

describe("task model contribution contracts", () => {
  it.each(Object.entries(issueModelMessages))("aligns keys, placeholders and safe text in %s", (_locale, messages) => {
    expect(validateLocaleMessages(messages, issueModelMessages.en)).toEqual([]);
    for (const value of Object.values(messages)) {
      expect(value.trim()).not.toBe("");
      expect(value).not.toMatch(/<\/?[A-Za-z]|javascript\s*:|data\s*:/i);
    }
  });
});
