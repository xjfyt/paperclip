import { describe, expect, it } from "vitest";
import { validateLocaleMessages } from "./locale-validation";
import { monitorSurfaceMessages } from "./monitor-surface-test-resources";

describe("monitor surfaces contribution contracts", () => {
  it.each(Object.entries(monitorSurfaceMessages))("aligns keys, placeholders and safe text in %s", (_locale, messages) => {
    expect(validateLocaleMessages(messages, monitorSurfaceMessages.en)).toEqual([]);
    for (const value of Object.values(messages)) {
      expect(value.trim()).not.toBe("");
      expect(value).not.toMatch(/<\/?[A-Za-z]|javascript\s*:|data\s*:/i);
    }
  });
});
