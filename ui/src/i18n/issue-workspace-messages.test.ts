import { describe, expect, it } from "vitest";
import { validateLocaleMessages } from "./locale-validation";
import { issueWorkspaceMessages } from "./issue-workspace-test-resources";

describe("task workspace contribution contracts", () => {
  it.each(Object.entries(issueWorkspaceMessages))("aligns keys, placeholders and safe text in %s", (_locale, messages) => {
    expect(validateLocaleMessages(messages, issueWorkspaceMessages.en)).toEqual([]);
    for (const value of Object.values(messages)) {
      expect(value.trim()).not.toBe("");
      expect(value).not.toMatch(/<\/?[A-Za-z]|javascript\s*:|data\s*:/i);
    }
  });
});
