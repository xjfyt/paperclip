import { describe, expect, it } from "vitest";
import { normalizeLocale, resolveLocale } from "./preferences";

describe("MiMouse locale preference", () => {
  it.each([["en-GB", "en"], ["es-MX", "es"], ["ja-JP", "ja"], ["zh-Hans-SG", "zh-CN"], ["zh_CN", "zh-CN"]])("normalizes %s", (input, output) => {
    expect(normalizeLocale(input)).toBe(output);
  });
  it.each(["zh-TW", "zh-Hant", "zh-HK", "zh", "fr", "english", ""])('does not invent support for %s', input => {
    expect(normalizeLocale(input)).toBeNull();
  });
  it("honors explicit selection before browser languages", () => {
    expect(resolveLocale("ja", ["zh-CN", "en"])).toBe("ja");
    expect(resolveLocale("bad", ["fr", "es-AR"])).toBe("es");
    expect(resolveLocale(null, ["zh-TW"])).toBe("en");
    expect(resolveLocale(null, [])).toBe("en");
  });
});
