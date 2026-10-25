import path from "node:path";
import { describe, expect, it } from "vitest";
import { getUiParserSource, loadExternalAdapterPackage } from "./plugin-loader.js";
describe("MiMouse external packages on the upstream loader", () => {
  it.each([["qoder-cn", "qoder_cn"], ["workbuddy", "workbuddy"]])("loads %s without invoking a provider", async (directory, expectedType) => {
    const folder = path.resolve(import.meta.dirname, "../../../external-adapters", directory);
    const adapter = await loadExternalAdapterPackage(`@mimouse/paperclip-${directory}`, folder);
    expect(adapter.type).toBe(expectedType); expect(adapter.execute).toBeTypeOf("function");
    expect(adapter.testEnvironment).toBeTypeOf("function"); expect(adapter.sessionCodec).toBeTruthy();
    expect(adapter.getConfigSchema?.()).toBeTruthy();
    if (directory === "qoder-cn") expect(getUiParserSource(expectedType)).toContain("parse");
  });
});
