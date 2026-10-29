import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { build } from "vite";
import { assertProductionChunkBudget, productionChunkBudgetPlugin, reviewedParserModulePath } from "./vite-chunk-budget";

const changed = vi.hoisted(() => ({ source: false, version: false }));
vi.mock("node:fs", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, readFileSync: (...args: Parameters<typeof actual.readFileSync>) => {
    const content = actual.readFileSync(...args);
    const file = String(args[0]).replaceAll("\\", "/");
    if (changed.source && file.endsWith("/chunks/mermaid-parser.core/chunk-FOHPRMQF.mjs")) return Buffer.concat([Buffer.from(content), Buffer.from("\n// changed upstream\n")]);
    if (changed.version && file.includes("/@mermaid-js/parser/") && file.endsWith("/package.json")) return JSON.stringify({ ...JSON.parse(String(content)), version: "1.2.2" });
    return content;
  } };
});

const parserSource = realpathSync(reviewedParserModulePath());
const chunk = (code: string, modules = { [parserSource]: {} }) => ({ fileName: "fixture.js", code, modules });
const roots: string[] = [];
afterEach(async () => { changed.source = changed.version = false; await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

it("counts UTF-8 bytes and enforces the ordinary budget for unknown modules", () => {
  expect(() => assertProductionChunkBudget(chunk("x".repeat(500_000), { "app.ts": {} }))).not.toThrow();
  expect(() => assertProductionChunkBudget(chunk("字".repeat(170_000), { "app.ts": {} }))).toThrow("510000 bytes");
  expect(() => assertProductionChunkBudget(chunk("x".repeat(500_001), { "app.ts": {} }))).toThrow("budget is 500000");
});

it("bounds the exact standalone reviewed parser and rejects mixed or spoofed module identities", () => {
  expect(() => assertProductionChunkBudget(chunk("x".repeat(750_000)))).not.toThrow();
  expect(() => assertProductionChunkBudget(chunk("x".repeat(750_001)))).toThrow();
  expect(() => assertProductionChunkBudget(chunk("x".repeat(600_000), { [parserSource]: {}, "app.ts": {} }))).toThrow();
  expect(() => assertProductionChunkBudget(chunk("x".repeat(600_000), { [path.join(os.tmpdir(), "chunks/mermaid-parser.core/chunk-FOHPRMQF.mjs")]: {} }))).toThrow();
});

it.each(["source", "version"] as const)("requires review after the upstream %s changes", key => {
  changed[key] = true;
  expect(() => assertProductionChunkBudget(chunk("x".repeat(600_000)))).toThrow();
});

async function fixture(entrySource: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), "paperclip-chunk-budget-")); roots.push(root);
  const entry = path.join(root, "entry.js"); await writeFile(entry, entrySource);
  return { root, entry };
}

it("rejects an oversized actual application bundle through the Vite plugin", async () => {
  const f = await fixture(`globalThis.fixture = ${JSON.stringify("x".repeat(510_000))};`);
  await expect(build({ configFile: false, root: f.root, logLevel: "silent", plugins: [productionChunkBudgetPlugin()],
    build: { write: false, minify: "oxc", rolldownOptions: { input: f.entry } } })).rejects.toThrow("budget is 500000");
});

it("accepts the actual lazy parser chunk and rejects the same bytes merged with application code", async () => {
  const f = await fixture(`globalThis.loadParser = () => import(${JSON.stringify(parserSource.replaceAll("\\", "/"))});`);
  const result = await build({ configFile: false, root: f.root, logLevel: "silent", plugins: [productionChunkBudgetPlugin()],
    build: { write: false, minify: "oxc", rolldownOptions: { input: f.entry, output: { keepNames: true } } } });
  const output = (Array.isArray(result) ? result[0] : result) as { output: Array<{ type: string; code: string; modules: Record<string, unknown> }> };
  const parser = output.output.find(item => item.type === "chunk" && Object.keys(item.modules).some(id => id.replaceAll("\\", "/") === parserSource.replaceAll("\\", "/")));
  expect(parser).toBeDefined(); expect(Buffer.byteLength(parser!.code)).toBeGreaterThan(500_000);
  await expect(build({ configFile: false, root: f.root, logLevel: "silent", plugins: [productionChunkBudgetPlugin()],
    build: { write: false, minify: "oxc", rolldownOptions: { input: f.entry, output: { keepNames: true, codeSplitting: false } } } })).rejects.toThrow("mixed or changed modules require review");
}, 30_000);
