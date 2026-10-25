import { changeLocale, useTranslation } from "@/i18n";
import { SUPPORTED_LOCALES, type SupportedLocale } from "@/i18n/preferences";

const names: Record<SupportedLocale, string> = {
  en: "English", "zh-CN": "简体中文", es: "Español", ja: "日本語",
};

export function LanguageSelector() {
  const { t, i18n } = useTranslation();
  return (
    <select
      aria-label={t("common.language")}
      value={i18n.language}
      onChange={(event) => void changeLocale(event.target.value as SupportedLocale)}
      className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
    >
      {SUPPORTED_LOCALES.map((locale) => <option key={locale} value={locale}>{names[locale]}</option>)}
    </select>
  );
}
