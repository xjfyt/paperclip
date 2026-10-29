import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { Plugin } from "vite";

export const APPLICATION_CHUNK_BUDGET_BYTES = 500_000;
export const REVIEWED_PARSER_CHUNK_BUDGET_BYTES = 750_000;
const PARSER_VERSION = "1.2.1";
const PARSER_SOURCE_HASH = "5c83305b04a62463567bdf6d82d9ba9dfc3795e516d8cc848e6981504af48068";
const PARSER_FILE = "chunks/mermaid-parser.core/chunk-FOHPRMQF.mjs";
const require = createRequire(import.meta.url);

interface BudgetChunk { fileName: string; code: string; modules: Record<string, unknown> }

export function reviewedParserModulePath(): string {
  const mermaidRequire = createRequire(require.resolve("mermaid"));
  // The parser exposes an ESM-only "import" condition. Locate its installed
  // dependency directory without attempting CommonJS conditional resolution.
  const directory = mermaidRequire.resolve.paths("@mermaid-js/parser")?.map(root => path.join(root, "@mermaid-js/parser"))
    .find(root => existsSync(path.join(root, "package.json")));
  if (!directory) throw new Error("The reviewed Mermaid parser dependency is missing");
  return path.join(directory, "dist", PARSER_FILE);
}

/** This is a build-size contract, not a trust boundary against build plugins.
 * The reviewed exception is one immutable upstream prebundle, never a general
 * vendor allowance. A source/version change requires another explicit review. */
function isReviewedParser(chunk: BudgetChunk): boolean {
  const modules = Object.keys(chunk.modules);
  if (modules.length !== 1 || !modules[0].replaceAll("\\", "/").endsWith(`/${PARSER_FILE}`)) return false;
  try {
    const expected = reviewedParserModulePath();
    const manifest = JSON.parse(readFileSync(path.resolve(path.dirname(expected), "../../../package.json"), "utf8")) as { name?: string; version?: string };
    return manifest.name === "@mermaid-js/parser" && manifest.version === PARSER_VERSION && realpathSync(modules[0]) === realpathSync(expected)
      && createHash("sha256").update(readFileSync(expected)).digest("hex") === PARSER_SOURCE_HASH;
  } catch { return false; }
}

export function assertProductionChunkBudget(chunk: BudgetChunk): void {
  const bytes = Buffer.byteLength(chunk.code, "utf8");
  if (bytes <= APPLICATION_CHUNK_BUDGET_BYTES) return;
  if (bytes <= REVIEWED_PARSER_CHUNK_BUDGET_BYTES && isReviewedParser(chunk)) return;
  throw new Error(`JavaScript chunk ${chunk.fileName} is ${bytes} bytes; budget is ${APPLICATION_CHUNK_BUDGET_BYTES}. `
    + "Only the exact reviewed standalone Mermaid parser may reach 750000 bytes; mixed or changed modules require review.");
}

export function productionChunkBudgetPlugin(): Plugin {
  return {
    name: "paperclip-chunk-budget",
    apply: "build",
    generateBundle(_options, bundle) {
      for (const chunk of Object.values(bundle)) if (chunk.type === "chunk") assertProductionChunkBudget(chunk);
    },
  };
}
