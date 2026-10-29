import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// npm.cmd/pnpm.cmd are shell launchers, not executables for execFileSync.
// On Windows invoke their installed JS entry points with this Node runtime.
const npmCli = process.platform === "win32"
  ? path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js")
  : null;
const inheritedPnpmCli = process.env.npm_execpath && /(?:^|[/\\])pnpm\.(?:cjs|mjs|js)$/i.test(process.env.npm_execpath)
  ? process.env.npm_execpath
  : null;
const pnpmCli = inheritedPnpmCli ?? (process.platform === "win32"
  ? path.join(path.dirname(process.execPath), "node_modules/pnpm/bin/pnpm.cjs")
  : null);

function parsePackMetadata(output: string) {
  const parsed = JSON.parse(output);
  // npm 11 emits an array; npm 12 keys pack metadata by package name.
  const metadata = Array.isArray(parsed) ? parsed[0] : parsed?.["@paperclipai/skills-catalog"];
  if (!metadata || typeof metadata.filename !== "string" || !Array.isArray(metadata.files)
    || metadata.files.some((entry: unknown) => !entry || typeof entry !== "object" || typeof (entry as { path?: unknown }).path !== "string")) {
    throw new Error(`Unexpected npm pack metadata shape from ${packageRoot}`);
  }
  return metadata as { filename: string; files: Array<{ path: string }> };
}

function readPackMetadata(packDestination: string) {
  const output = execFileSync(npmCli ? process.execPath : "npm", [...(npmCli ? [npmCli] : []), "pack", "--json", "--pack-destination", packDestination], {
    cwd: packageRoot,
    encoding: "utf8",
  });
  return parsePackMetadata(output);
}

describe("skills catalog package artifacts", () => {
  const cleanup: string[] = [];

  function createPackDestination() {
    const destination = mkdtempSync(path.join(tmpdir(), "paperclip-skills-catalog-pack-"));
    cleanup.push(destination);
    return destination;
  }

  afterEach(async () => {
    await Promise.all(cleanup.map((entry) => rm(entry, { force: true, recursive: true })));
    cleanup.length = 0;
  });

  it.each([
    [{ filename: "catalog.tgz", files: [{ path: "package.json" }] }],
    { "@paperclipai/skills-catalog": { filename: "catalog.tgz", files: [{ path: "package.json" }] } },
  ])("reads npm pack metadata without depending on the npm major output shape (%j)", (metadata) => {
    expect(parsePackMetadata(JSON.stringify(metadata))).toEqual({ filename: "catalog.tgz", files: [{ path: "package.json" }] });
  });

  it.each([[], {}, [{ filename: "catalog.tgz", files: null }], [{ filename: "catalog.tgz", files: [{}] }]])("rejects incomplete npm pack metadata (%j)", (metadata) => {
    expect(() => parsePackMetadata(JSON.stringify(metadata))).toThrow("Unexpected npm pack metadata shape");
  });

  it("packs dist manifest and catalog files for npm artifact consumers", () => {
    let metadata = readPackMetadata(createPackDestination());

    if (!metadata.files.some((entry) => entry.path === "dist/generated/catalog.json")) {
      execFileSync(pnpmCli ? process.execPath : "pnpm", [...(pnpmCli ? [pnpmCli] : []), "--filter", "@paperclipai/skills-catalog", "build"], {
        cwd: packageRoot,
        stdio: "ignore",
      });
      metadata = readPackMetadata(createPackDestination());
    }

    const paths = metadata.files.map((entry) => entry.path);

    expect(paths).toContain("dist/generated/catalog.json");
    expect(paths).toContain("generated/catalog.json");
    expect(paths).toContain("catalog/bundled/software-development/github-pr-workflow/SKILL.md");
    expect(paths).toContain("catalog/optional/browser/agent-browser/SKILL.md");
    expect(paths).toContain("package.json");
  }, 120_000);
});
