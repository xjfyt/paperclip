import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";
import { resolvePnpmInvocation } from "./pnpm-invocation.js";

const roots: string[] = [];
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "pnpm invocation "));
  roots.push(root);
  return root;
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

it("runs a discovered JavaScript entrypoint with literal argument boundaries and spaces", async () => {
  const root = await fixture();
  const entry = path.join(root, "node_modules/pnpm/bin/pnpm.cjs");
  await mkdir(path.dirname(entry), { recursive: true });
  await writeFile(entry, "process.stdout.write(JSON.stringify(process.argv.slice(2)))");
  const command = resolvePnpmInvocation({ Path: root }, "win32");
  const args = ["--filter", "@example/a & echo unexpected", "quote\"value", "build"];
  const result = await promisify(execFile)(command.file, [...command.args, ...args]);
  expect(JSON.parse(result.stdout)).toEqual(args);
});

it("uses an explicit installed pnpm entrypoint before PATH", async () => {
  const root = await fixture();
  const entry = path.join(root, "pnpm.cjs");
  await writeFile(entry, "");
  expect(resolvePnpmInvocation({ npm_execpath: entry, PATH: "" }, "win32"))
    .toEqual({ file: process.execPath, args: [entry] });
});

it("does not execute a batch wrapper or unrelated npm_execpath", async () => {
  const root = await fixture();
  for (const name of ["pnpm.cmd", "npm-cli.js"]) {
    const entry = path.join(root, name);
    await writeFile(entry, "must not execute");
    expect(() => resolvePnpmInvocation({ npm_execpath: entry, PATH: root }, "win32")).toThrow(/Cannot find/);
  }
});

it("keeps an installed standalone executable out of Node's script arguments", async () => {
  const root = await fixture();
  const entry = path.join(root, "pnpm.exe");
  await writeFile(entry, "resolution-only fixture");
  expect(resolvePnpmInvocation({ PATH: root }, "win32")).toEqual({ file: entry, args: [] });
});

it("preserves POSIX executable discovery and rejects implicit relative Windows search directories", () => {
  expect(resolvePnpmInvocation({}, "linux")).toEqual({ file: "pnpm", args: [] });
  expect(() => resolvePnpmInvocation({ PATH: ["", ".", "relative"].join(path.delimiter) }, "win32")).toThrow(/Cannot find/);
});
