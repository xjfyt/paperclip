import { describe, expect, it } from "vitest";
import { validateLocaleMessages } from "./locale-validation";
import { issuePropertyControlsMessages, propertyLabelMessages } from "./issue-property-controls-test-resources";

describe("issue property controls contribution contracts", () => {
  it.each(Object.entries(issuePropertyControlsMessages))("keeps keys, placeholders and safe text aligned in %s", (_locale, messages) => {
    expect(validateLocaleMessages(messages, issuePropertyControlsMessages.en)).toEqual([]);
    for (const value of Object.values(messages)) {
      expect(value.trim()).not.toBe("");
      expect(value).not.toMatch(/<\/?[A-Za-z]|javascript\s*:|data\s*:/i);
    }
  });
  it.each(Object.entries(propertyLabelMessages))("keeps fixed property-label keys and placeholders aligned in %s", (_locale, messages) => {
    expect(validateLocaleMessages(messages, propertyLabelMessages.en)).toEqual([]);
    expect(messages.triage.trim()).not.toBe("");
    expect(messages.subtasks.trim()).not.toBe("");
  });
});
