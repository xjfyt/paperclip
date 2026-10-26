import { describe, expect, it } from "vitest";
import { validateLocaleMessages } from "./locale-validation";
import { issuePropertyControlsMessages } from "./issue-property-controls-test-resources";

describe("issue property controls contribution contracts", () => {
  it.each(Object.entries(issuePropertyControlsMessages))("keeps keys, placeholders and safe text aligned in %s", (_locale, messages) => {
    expect(validateLocaleMessages(messages, issuePropertyControlsMessages.en)).toEqual([]);
    for (const value of Object.values(messages)) {
      expect(value.trim()).not.toBe("");
      expect(value).not.toMatch(/<\/?[A-Za-z]|javascript\s*:|data\s*:/i);
    }
  });
});
