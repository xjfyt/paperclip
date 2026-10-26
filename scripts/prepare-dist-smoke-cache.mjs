#!/usr/bin/env node
// Explicit online cache preparation only. Never install or execute package code.
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawnSync, spawn } from 'node:child_process';
import { releaseClosure } from './dist-install-smoke.mjs';
import { configureBundledProviderOverrides, createBundledInstallManifest, materializePublishManifest } from './prepare-bundled-package.mjs';

export function hostMatches(list, host) {
  return !Array.isArray(list) || (!list.includes(`!${host}`) && (list.every(v => v.startsWith('!')) || list.includes(host)));
}
export function cacheEnvironment(parent, home, cache, fixture) {
  const env = {};
  // Preserve already-provisioned routing/trust, never print values, discover
  // credentials, replace proxies, install certificates or disable TLS validation.
  for (const key of ['PATH', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy', 'npm_config_proxy', 'npm_config_https_proxy', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'REQUESTS_CA_BUNDLE']) {
    if (parent[key] !== undefined) env[key] = parent[key];
  }
  return { ...env, HOME: home, TMPDIR: fixture, npm_config_cache: cache,
    npm_config_userconfig: resolve(fixture, 'user.npmrc'), npm_config_globalconfig: resolve(fixture, 'global.npmrc'),
    npm_config_registry: 'https://registry.npmjs.org', npm_config_ignore_scripts: 'true', npm_config_audit: 'false', npm_config_fund: 'false',
    npm_config_fetch_retries: '0', npm_config_fetch_timeout: '60000', npm_config_offline: 'false' };
}
async function main() {
  const args = process.argv.slice(2), option = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
  const source = realpathSync(option('--source') ?? '.');
  const cache = realpathSync(option('--cache') ?? (() => { throw new Error('--cache required'); })());
  const scratch = realpathSync(option('--scratch') ?? (() => { throw new Error('--scratch required'); })());
  const fixture = mkdtempSync(resolve(scratch, 'paperclip-dist-cache-')), home = resolve(fixture, 'home'); mkdirSync(home);
  const env = cacheEnvironment(process.env, home, cache, fixture);
  writeFileSync(env.npm_config_userconfig, ''); writeFileSync(env.npm_config_globalconfig, '');
  console.log(`Cache preparation fixture: ${fixture}`);
  const { getReleasePackages } = await import(pathToFileURL(resolve(source, 'scripts/release-package-map.mjs')).href);
  const packages = releaseClosure(getReleasePackages());
  const edges = [], seen = new Set();
  for (const pkg of packages) for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const [name, spec] of Object.entries(pkg.pkg[section] ?? {})) {
      if (name.startsWith('@paperclipai/')) continue;
      if (section === 'peerDependencies' && pkg.pkg.peerDependenciesMeta?.[name]?.optional) continue;
      if (typeof spec !== 'string' || /^(workspace:|file:|link:|git|https?:)/.test(spec)) throw new Error(`Non-registry edge requires review: ${name}`);
      const key = `${name}@${spec}`; if (seen.has(key)) continue; seen.add(key);
      edges.push({ name, spec, optional: section === 'optionalDependencies' });
    }
  }
  const server = packages.find(p => p.name === '@paperclipai/server').pkg;
  const bundled = server.bundleDependencies ?? server.bundledDependencies ?? [];
  const rootPackage = JSON.parse(readFileSync(resolve(source, 'package.json'), 'utf8'));
  const profiles = JSON.parse(readFileSync(resolve(source, 'packages/paperclip-runner/acpx-profiles.json'), 'utf8'));
  const { installManifest } = configureBundledProviderOverrides(createBundledInstallManifest(materializePublishManifest(server), bundled), bundled, rootPackage, profiles);
  const urls = new Set(), failures = [];
  let count = 0, completed = 0;
  for (const [index, edge] of edges.entries()) {
    const directory = resolve(fixture, `edge-${index}`); mkdirSync(directory);
    const dependencySection = edge.optional ? 'optionalDependencies' : 'dependencies';
    const manifest = { name: `paperclip-cache-edge-${index}`, private: true, version: '0.0.0', [dependencySection]: { [edge.name]: edge.spec } };
    // Preserve canonical qualification only for the exact pinned producer edge;
    // other dependency ranges must resolve normally, without overrides or aliases.
    if (edge.name === '@agentclientprotocol/codex-acp' && edge.spec === profiles.profiles.codex.agentServerVersion) manifest.overrides = installManifest.overrides;
    writeFileSync(resolve(directory, 'package.json'), JSON.stringify(manifest, null, 2));
    console.log(`Resolve ${index + 1}/${edges.length}: ${edge.name}@${edge.spec}`);
    const lock = spawnSync('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: directory, env, encoding: 'utf8', timeout: 180_000, maxBuffer: 20 * 1024 * 1024 });
    const output = `${lock.stdout ?? ''}\n${lock.stderr ?? ''}`;
    writeFileSync(resolve(directory, 'resolution.log'), output);
    if (lock.error || lock.status !== 0) {
      if (!lock.error && /npm error code (?:ERESOLVE|EOVERRIDE|EBADPLATFORM)/.test(output)) {
        failures.push({ name: edge.name, spec: edge.spec, log: resolve(directory, 'resolution.log') });
        console.log(`Unresolved metadata branch (no force/legacy): ${edge.name}; see its resolution.log`);
        continue;
      }
      throw new Error(`Cache metadata resolution failed for ${edge.name}: ${lock.error?.message ?? output}; stopped without rerouting`);
    }
    completed++;
    const plan = JSON.parse(readFileSync(resolve(directory, 'package-lock.json'), 'utf8'));
    for (const [path, pkg] of Object.entries(plan.packages ?? {})) {
      if (!path || !hostMatches(pkg.os, process.platform) || !hostMatches(pkg.cpu, process.arch)) continue;
      if (pkg.resolved && !pkg.resolved.startsWith('https://registry.npmjs.org/')) throw new Error('Resolved package is not on the official npm registry; review before caching');
      if (!pkg.resolved || urls.has(pkg.resolved)) continue;
      await new Promise((yes, no) => {
        const p = spawn('npm', ['cache', 'add', pkg.resolved, '--ignore-scripts'], { cwd: fixture, env, stdio: 'inherit', timeout: 120_000 });
        p.on('error', no); p.on('exit', code => code === 0 ? yes() : no(new Error(`Cache download failed (${code}); stopped without rerouting`)));
      });
      urls.add(pkg.resolved);
      if (++count % 25 === 0) console.log(`Cached ${count} unique host-compatible tarballs`);
    }
  }
  writeFileSync(resolve(fixture, 'CACHE-COVERAGE.json'), JSON.stringify({ source, packageNames: packages.map(p => p.name), requestedEdges: edges.length, resolvedEdges: completed, tarballs: urls.size, unresolved: failures, platform: process.platform, arch: process.arch }, null, 2));
  console.log(`Cache preparation coverage: ${completed}/${edges.length} direct edges, ${urls.size} tarballs, ${failures.length} unresolved metadata branches. Strict offline install/start smoke has NOT run.`);
  if (failures.length) process.exitCode = 2;

}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
