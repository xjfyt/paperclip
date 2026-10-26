import { expect, it } from "vitest";
import { agentSetupLoginMessages } from "./agent-setup-login-test-resources";
import { validateLocaleMessages } from "./locale-validation";
import { LocalizedUiError, localizedUiErrorMessage } from "../lib/localized-ui-error";
it.each(Object.entries(agentSetupLoginMessages))("validates login resources and placeholders in %s", (locale, messages) => {
  expect(validateLocaleMessages(messages, agentSetupLoginMessages.en)).toEqual([]);
  if (locale !== "en") for (const key of Object.keys(messages) as Array<keyof typeof messages>) {
    expect(messages[key], `${locale}:${key}`).not.toBe(agentSetupLoginMessages.en[key]);
  }
});
it("carries only explicit local error keys; external errors stay verbatim", () => {
  const local = new LocalizedUiError("agentSetupLoginUi.chooseCompany", "Choose a company before connecting.");
  expect(local).toBeInstanceOf(Error);
  expect(local.message).toBe("Choose a company before connecting.");
  expect(localizedUiErrorMessage(local, "fallback")).toEqual({ key: "agentSetupLoginUi.chooseCompany" });
  expect(localizedUiErrorMessage(new Error("Provider raw diagnostic"), "fallback")).toBe("Provider raw diagnostic");
  expect(localizedUiErrorMessage(null, "fallback")).toEqual({ key: "fallback" });
});
