import { describe, expect, it } from "vitest";
import { validateLocaleMessages } from "./locale-validation";
import { composerAssigneeMessages } from "./composer-assignee-test-resources";

describe("composer assignee contribution contracts", () => {
  it.each(Object.entries(composerAssigneeMessages))("keeps keys, placeholders and safe text aligned in %s", (_locale, messages) => {
    expect(validateLocaleMessages(messages, composerAssigneeMessages.en)).toEqual([]);
    for (const value of Object.values(messages)) {
      expect(value.trim()).not.toBe("");
      expect(value).not.toMatch(/<\/?[A-Za-z]|javascript\s*:|data\s*:/i);
    }
  });
});
