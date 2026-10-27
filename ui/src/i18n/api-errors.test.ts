import { afterEach, expect, it } from "vitest";
import { ApiUnavailableError, isTemporaryApiError, readApiJson } from "@/api/response";
import { apiUnavailableUiMessage, apiErrorText, describeApiUiError, renderApiUiMessage } from "./api-errors";
import { apiErrorMessages, i18n } from "./api-errors-test-resources";
import { validateLocaleMessages } from "./locale-validation";

afterEach(async () => { await i18n.changeLanguage("en"); });
it("keeps the real API error class, status, raw message and reconnect classification intact", async () => {
  const response = new Response("<html>Unavailable</html>", { status: 503 });
  const error = await readApiJson(response).catch(value => value);
  expect(error).toBeInstanceOf(ApiUnavailableError);
  expect(error.status).toBe(503);
  expect(error.message).toBe(apiErrorMessages.en.unavailable);
  expect(isTemporaryApiError(error)).toBe(true);
  const descriptor = describeApiUiError(error, "unused");
  for (const [locale, messages] of Object.entries(apiErrorMessages)) {
    expect(validateLocaleMessages(messages, apiErrorMessages.en)).toEqual([]);
    await i18n.changeLanguage(locale);
    expect(renderApiUiMessage(descriptor)).toBe(messages.unavailable);
    expect(apiErrorText(new Error(error.message), "unused")).toBe(error.message);
    expect(apiUnavailableUiMessage({ name: "ApiUnavailableError", message: error.message, status: 503 })).toBeUndefined();
    expect(apiErrorText(new Error("Provider diagnostic 用户 / model_id"), "unused")).toBe("Provider diagnostic 用户 / model_id");
    expect(error.message).toBe(apiErrorMessages.en.unavailable);
    expect(error.status).toBe(503);
  }
});
