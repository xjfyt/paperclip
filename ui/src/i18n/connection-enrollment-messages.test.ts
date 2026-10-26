import { expect, it } from "vitest";
import { connectionEnrollmentMessages } from "./connection-enrollment-test-resources";
import { validateLocaleMessages } from "./locale-validation";
it.each(Object.entries(connectionEnrollmentMessages))("validates actual enrollment resources in %s", (locale, messages) => {
  expect(validateLocaleMessages(messages, connectionEnrollmentMessages.en)).toEqual([]);
  for (const [key, value] of Object.entries(messages)) {
    expect(value).not.toMatch(/<\/?[A-Za-z]|javascript\s*:|data\s*:/i);
    if (locale !== "en") expect(value).not.toBe(connectionEnrollmentMessages.en[key as keyof typeof messages]);
  }
});
