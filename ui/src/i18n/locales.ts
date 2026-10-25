import type { Resource } from "i18next";
import { assertValidLocaleMessages } from "./locale-validation";
import { SUPPORTED_LOCALES } from "./preferences";
import en from "./locales/en.json";
import zhCN from "./locales/zh-CN.json";
import es from "./locales/es.json";
import ja from "./locales/ja.json";

export const DEFAULT_LOCALE = "en" as const;
export const localeMessages = { en, "zh-CN": zhCN, es, ja };
for (const [locale, messages] of Object.entries(localeMessages)) {
  try { assertValidLocaleMessages(messages); }
  catch (error) { throw new Error(`Invalid ${locale} locale messages: ${String(error)}`); }
}
export const supportedLocales = [...SUPPORTED_LOCALES];
export const i18nextResources: Resource = Object.fromEntries(
  Object.entries(localeMessages).map(([locale, messages]) => [locale, { translation: messages }]),
);
export type { SupportedLocale } from "./preferences";
