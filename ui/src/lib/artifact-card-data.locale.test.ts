import { afterEach, expect, it } from "vitest";
import { i18n } from "@/i18n";
import { artifactFileSize } from "./artifact-card-data";
afterEach(async () => { await i18n.changeLanguage("en"); });
it.each(["en", "zh-CN", "es", "ja"])("keeps canonical byte labels stable and opts into %s only for display", async locale => {
  await i18n.changeLanguage(locale);
  expect(artifactFileSize(null)).toBe("");
  expect(artifactFileSize(1000)).toBe("1000 B");
  expect(artifactFileSize(123456)).toBe("120.6 KB");
  expect(artifactFileSize(1048576)).toBe("1.0 MB");
  expect(artifactFileSize(1000, locale)).toBe(`${new Intl.NumberFormat(locale).format(1000)} B`);
  expect(artifactFileSize(123456, locale)).toBe(`${new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(123456 / 1024)} KB`);
});
