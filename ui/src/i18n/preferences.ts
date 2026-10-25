export const SUPPORTED_LOCALES = ["en", "zh-CN", "es", "ja"] as const;
export type SupportedLocale = typeof SUPPORTED_LOCALES[number];
export const LOCALE_STORAGE_KEY = "paperclip.locale";

export function normalizeLocale(value: string | null | undefined): SupportedLocale | null {
  const locale = value?.trim().replace(/_/g, "-").toLowerCase();
  if (!locale) return null;
  if (/^en(?:-|$)/.test(locale)) return "en";
  if (/^es(?:-|$)/.test(locale)) return "es";
  if (/^ja(?:-|$)/.test(locale)) return "ja";
  if (/^zh-(?:cn|hans)(?:-|$)/.test(locale)) return "zh-CN";
  return null;
}

export function resolveLocale(saved: string | null, languages: readonly string[]): SupportedLocale {
  const explicit = SUPPORTED_LOCALES.find((locale) => locale === saved);
  if (explicit) return explicit;
  for (const candidate of languages) {
    const locale = normalizeLocale(candidate);
    if (locale) return locale;
  }
  return "en";
}

export function initialLocale(): SupportedLocale {
  let saved: string | null = null;
  try { saved = globalThis.localStorage?.getItem(LOCALE_STORAGE_KEY) ?? null; } catch { /* Storage may be disabled. */ }
  return resolveLocale(saved, typeof navigator === "undefined" ? [] : navigator.languages);
}
