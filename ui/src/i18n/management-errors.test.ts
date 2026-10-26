import { afterEach, expect, it } from "vitest";
import { i18n, managementMessages } from "./management-test-resources";
import { describeManagementError, ManagementUiError, managementErrorText, renderManagementError } from "./management-errors";
import { validateLocaleMessages } from "./locale-validation";
afterEach(async () => { await i18n.changeLanguage("en"); });
it.each(Object.entries(managementMessages))("validates management messages and deferred errors in %s", async (locale, messages) => {
  expect(validateLocaleMessages(messages, managementMessages.en)).toEqual([]);
  const pending = describeManagementError(null, "managementUi.approveFailed");
  const local = new ManagementUiError("managementUi.selectOrganization");
  await i18n.changeLanguage(locale);
  expect(renderManagementError(pending)).toBe(messages.approveFailed);
  expect(managementErrorText(local, "managementUi.tryAgain")).toBe(messages.selectOrganization);
  expect(managementErrorText(new Error("Original server error <name>"), "managementUi.tryAgain")).toBe("Original server error <name>");
  for (const [key, message] of Object.entries(messages)) {
    expect([...message.matchAll(/<\/?\d+>/g)].map(match => match[0]).sort()).toEqual(
      [...managementMessages.en[key as keyof typeof managementMessages.en].matchAll(/<\/?\d+>/g)].map(match => match[0]).sort(),
    );
  }
});
