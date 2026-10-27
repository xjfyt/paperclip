import { ApiUnavailableError } from "@/api/response";
import type { LocalizedUiMessage } from "@/lib/localized-ui-error";
import { t } from "./index";

/** Explicit local provenance only: equal server/browser text must remain raw. */
export type ApiUnavailableUiMessage = { key: "apiErrorUi.unavailable" };
export function apiUnavailableUiMessage(error: unknown): ApiUnavailableUiMessage | undefined {
  return error instanceof ApiUnavailableError ? { key: "apiErrorUi.unavailable" } : undefined;
}

/** Retain descriptors in state so a language change does not require a retry. */
export function describeApiUiError(error: unknown, fallback: LocalizedUiMessage): LocalizedUiMessage {
  return apiUnavailableUiMessage(error) ?? (error instanceof Error ? error.message : fallback);
}
export function renderApiUiMessage(message: LocalizedUiMessage): string {
  return typeof message === "string" ? message : t(message.key);
}
export function apiErrorText(error: unknown, fallback: LocalizedUiMessage): string {
  return renderApiUiMessage(describeApiUiError(error, fallback));
}
