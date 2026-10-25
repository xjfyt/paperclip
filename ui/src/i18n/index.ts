import i18n, { type InitOptions, type TOptions } from "i18next";
import { initReactI18next, useTranslation as useReactI18nextTranslation } from "react-i18next";

import { DEFAULT_LOCALE, i18nextResources, supportedLocales } from "./locales";

import { initialLocale, LOCALE_STORAGE_KEY, type SupportedLocale } from "./preferences";

const i18nextOptions: InitOptions = {
  resources: i18nextResources,
  lng: initialLocale(),
  fallbackLng: DEFAULT_LOCALE,
  supportedLngs: supportedLocales,
  defaultNS: "translation",
  interpolation: { escapeValue: false },
  returnObjects: false,
  initAsync: false,
};

void i18n.use(initReactI18next).init(i18nextOptions).catch((error: unknown) => {
  console.error("Failed to initialize i18next", error);
});

export function t(key: string, options: TOptions = {}) {
  return i18n.t(key, options);
}

export const useTranslation = useReactI18nextTranslation;
export { i18n };

function syncDocumentLanguage(language: string) {
  if (typeof document !== "undefined") document.documentElement.lang = language;
}
i18n.on("languageChanged", syncDocumentLanguage);
syncDocumentLanguage(i18n.language);

export async function changeLocale(locale: SupportedLocale): Promise<void> {
  await i18n.changeLanguage(locale);
  try { globalThis.localStorage?.setItem(LOCALE_STORAGE_KEY, locale); } catch { /* In-memory selection still works. */ }
}

export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(i18n.language, options).format(value);
}

export function formatDate(value: Date | number, options?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(i18n.language, options).format(value);
}

export function formatRelativeTime(value: number, unit: Intl.RelativeTimeFormatUnit): string {
  return new Intl.RelativeTimeFormat(i18n.language, { numeric: "auto" }).format(value, unit);
}
