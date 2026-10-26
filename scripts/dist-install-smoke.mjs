#!/usr/bin/env node
// Offline, scripts-disabled release producer + isolated real npm consumer.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { getReleasePackages } from './release-package-map.mjs';
import { materializePublishManifest } from './prepare-bundled-package.mjs';

export const MARKER = 'paperclip-all-dist-install-smoke-v1';
export function inside(root, path) {
  const rel = relative(root, path);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}
export function releaseClosure(packages, root = '@paperclipai/server') {
  const byName = new Map(packages.map(p => [p.name, p]));
  const seen = new Set(), result = [];
  function visit(name) {
    if (seen.has(name)) return;
    seen.add(name);
    const pkg = byName.get(name);
    if (!pkg || pkg.pkg.private) throw new Error(`Unpublished runtime workspace edge: ${name}`);
    for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
      for (const [dep, spec] of Object.entries(pkg.pkg[section] ?? {})) {
        if (dep.startsWith('@paperclipai/')) visit(dep);
        else if (String(spec).startsWith('workspace:')) throw new Error(`Unsupported workspace edge: ${name} -> ${dep}`);
      }
    }
    result.push(pkg);
  }
  visit(root);
  return result;
}
export function assertRuntimeExports(value, key = 'exports') {
  if (typeof value === 'string') {
    if (/\.(?:[cm]?ts|tsx)$/.test(value) || /^(?:\.\/)?src\//.test(value) || /(?:^|\/)\.\.\//.test(value) || /shim/i.test(value)) {
      throw new Error(`Non-dist runtime ${key}: ${value}`);
    }
  } else if (value && typeof value === 'object') {
    for (const [condition, child] of Object.entries(value)) {
      if (condition !== 'types') assertRuntimeExports(child, `${key}.${condition}`);
    }
  }
}
function main() {
  const args = process.argv.slice(2);
  const option = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
  if (args.includes('--help')) {
    console.log('node scripts/dist-install-smoke.mjs --source <built-checkout> --scratch <existing-scratch-dir> --cache <npm-cache> [--api-path /api/companies]');
    return;
  }
  const source = realpathSync(option('--source') ?? '.');
  const scratch = realpathSync(option('--scratch') ?? (() => { throw new Error('--scratch is required'); })());
  const cache = realpathSync(option('--cache') ?? (() => { throw new Error('--cache is required (offline only)'); })());
  const apiPath = option('--api-path');
  if (apiPath && (!apiPath.startsWith('/api/') || /[?#\\\s]/.test(apiPath))) throw new Error('Expected a read-only /api/ path');
  if (process.platform === 'win32') throw new Error('This fixture currently requires POSIX process-group cleanup');
  const fixture = mkdtempSync(resolve(scratch, 'paperclip-dist-smoke-'));
  console.log(`Fixture retained for diagnostics: ${fixture}`);
  writeFileSync(resolve(fixture, '.fixture-marker'), MARKER);
  const home = resolve(fixture, 'home'); mkdirSync(home);
  const env = { PATH: process.env.PATH, HOME: home, TMPDIR: fixture, LANG: 'C.UTF-8',
    npm_config_cache: cache, npm_config_offline: 'true', npm_config_ignore_scripts: 'true',
    npm_config_audit: 'false', npm_config_fund: 'false', npm_config_userconfig: resolve(fixture, 'empty.npmrc'),
    npm_config_globalconfig: resolve(fixture, 'empty-global.npmrc'), npm_config_registry: 'https://registry.npmjs.org' };
  writeFileSync(env.npm_config_userconfig, ''); writeFileSync(env.npm_config_globalconfig, '');
  const run = (command, argv, cwd, extra = {}) => {
    const p = spawnSync(command, argv, { cwd, env, stdio: 'inherit', timeout: 600_000, ...extra });
    if (extra.detached && p.pid) {
      try {
        process.kill(-p.pid, 'SIGTERM');
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
        process.kill(-p.pid, 'SIGKILL');
      } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    if (p.error || p.status !== 0) throw new Error(`${command} failed (${p.status}): ${p.error?.message ?? 'see output; offline cache/native payload may be incomplete'}`);
  };
  const packages = releaseClosure(getReleasePackages());
  // release.sh normalizes every public package to one release version before
  // packing; do the same only in disposable manifests, never in the checkout.
  const releaseVersion = packages.find(p => p.name === '@paperclipai/server').pkg.version;
  const tarballs = {};
  for (const pkg of packages) {
    const src = resolve(source, pkg.dir);
    if (readFileSync(resolve(src, 'package.json'), 'utf8') !== readFileSync(pkg.pkgPath, 'utf8')) {
      throw new Error(`Source manifest differs from smoke checkout: ${pkg.dir}`);
    }
    const stagedManifest = { ...pkg.pkg, version: releaseVersion };
    const manifest = materializePublishManifest(stagedManifest);
    assertRuntimeExports(manifest.exports); assertRuntimeExports(manifest.main, 'main');
    const staged = resolve(fixture, 'producer', pkg.dir); mkdirSync(staged, { recursive: true });
    for (const entry of new Set([...(pkg.pkg.files ?? []), 'README.md', 'LICENSE', 'LICENSE.md'])) {
      if (!inside(src, resolve(src, entry)) || /[*?]/.test(entry)) throw new Error(`Unsupported publish file pattern: ${pkg.name}: ${entry}`);
      let from = resolve(src, entry);
      if (pkg.name === '@paperclipai/server' && entry === 'ui-dist' && !existsSync(from)) from = resolve(source, 'ui/dist');
      if (entry === 'skills' && ['server', 'packages/adapters/claude-local', 'packages/adapters/codex-local'].includes(pkg.dir)) from = resolve(source, 'skills');
      if (!existsSync(from)) {
        // npm permits absent optional files entries; compiled dist is mandatory.
        if (entry === 'dist' || entry === 'ui-dist') throw new Error(`Missing built publish payload: ${from}`);
        continue;
      }
      cpSync(from, resolve(staged, entry), { recursive: true, dereference: true });
    }
    writeFileSync(resolve(staged, 'package.json'), JSON.stringify(stagedManifest, null, 2));
    let packDir = staged;
    if ((pkg.pkg.bundleDependencies ?? pkg.pkg.bundledDependencies ?? []).length) {
      packDir = resolve(fixture, 'bundled', pkg.dir); mkdirSync(dirname(packDir), { recursive: true });
      // Reuse canonical producer: patch/native-delegation semantics must not be approximated.
      const helper = new URL('./prepare-bundled-package.mjs', import.meta.url).href;
      run(process.execPath, ['--input-type=module', '-e', `import { prepareBundledPackage } from ${JSON.stringify(helper)}; prepareBundledPackage(${JSON.stringify(staged)}, ${JSON.stringify(packDir)}, { sourceRoot: ${JSON.stringify(source)} });`], fixture);
    } else writeFileSync(resolve(staged, 'package.json'), JSON.stringify(manifest, null, 2));
    const packed = spawnSync('npm', ['pack', '--ignore-scripts', '--offline', '--json'], { cwd: packDir, env, encoding: 'utf8', timeout: 600_000, maxBuffer: 20 * 1024 * 1024 });
    if (packed.error || packed.status !== 0) throw new Error(`Pack failed for ${pkg.name}: ${packed.stderr ?? packed.error}`);
    const [{ filename }] = JSON.parse(packed.stdout);
    tarballs[pkg.name] = `file:${resolve(packDir, filename)}`;
  }
  const consumer = resolve(fixture, 'consumer'); mkdirSync(consumer);
  writeFileSync(resolve(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module', dependencies: tarballs }, null, 2));
  run('npm', ['install', '--offline', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund'], consumer);
  for (const name of ['dist-install-runtime.mjs', 'dist-install-guard.mjs', 'dist-install-shutdown.mjs']) cpSync(new URL(name, import.meta.url), resolve(consumer, name));
  writeFileSync(resolve(consumer, 'smoke-plan.json'), JSON.stringify({ marker: MARKER, fixture, packages: packages.map(p => p.name), apiPath }));
  run(process.execPath, ['--import', './dist-install-guard.mjs', './dist-install-runtime.mjs'], consumer, { timeout: 240_000, detached: true,
    env: { ...env, PAPERCLIP_TELEMETRY_DISABLED: '1' } });
  console.log('PASS: real offline tarball install, all-dist runtime, guarded DB, startup, health and UI');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
