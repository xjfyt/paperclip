import { finishOwnedSmoke } from "./dist-install-shutdown.mjs";
import { readFileSync, realpathSync, existsSync, statSync, readdirSync, writeFileSync, appendFileSync, writeSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { resolve, relative, sep, isAbsolute } from 'node:path';
const plan = JSON.parse(readFileSync('./smoke-plan.json', 'utf8'));
const fixture = realpathSync(plan.fixture);
if (plan.marker !== 'paperclip-all-dist-install-smoke-v1' || readFileSync(resolve(fixture, '.fixture-marker'), 'utf8') !== plan.marker) throw new Error('Missing disposable fixture marker');
if (realpathSync(process.cwd()) !== resolve(fixture, 'consumer')) throw new Error('Fixture consumer mismatch');
const dataDir = resolve(fixture, 'home', 'db');
if (existsSync(dataDir)) throw new Error('Refusing reused DB fixture');
const allowed = new Set(plan.packages);
function inside(root, path) { const r = relative(root, path); return r !== '..' && !r.startsWith(`..${sep}`) && !isAbsolute(r); }
function checkExports(value, key = 'exports') {
  if (typeof value === 'string') {
    if (/\.(?:[cm]?ts|tsx)$/.test(value) || /^(?:\.\/)?src\//.test(value) || /(?:^|\/)\.\.\//.test(value) || /shim/i.test(value)) throw new Error(`Non-dist ${key}: ${value}`);
  } else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) if (k !== 'types') checkExports(v, `${key}.${k}`);
}
// Check nested bundled packages too, not just hoisted names. No symlink escapes.
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name), canonical = realpathSync(path);
    if (!inside(process.cwd(), canonical)) throw new Error(`Installed symlink escapes consumer: ${path}`);
    if (entry.isDirectory()) walk(path);
    else if (entry.name === 'package.json') {
      const p = JSON.parse(readFileSync(path, 'utf8'));
      if (p.name?.startsWith('@paperclipai/')) {
        if (!allowed.has(p.name) || p.private) throw new Error(`Unpublished first-party runtime: ${p.name}`);
        checkExports(p.exports); checkExports(p.main, 'main');
        if (p.publishConfig?.exports && JSON.stringify(p.exports) !== JSON.stringify(p.publishConfig.exports)) throw new Error(`Unmaterialized publishConfig: ${p.name}`);
        for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies']) for (const [name, spec] of Object.entries(p[section] ?? {})) {
          if (String(spec).startsWith('workspace:') || (name.startsWith('@paperclipai/') && !allowed.has(name))) throw new Error(`Unpublished runtime edge: ${p.name} -> ${name}`);
        }
      }
    }
  }
}
walk(resolve('node_modules'));
const serverRoot = resolve('node_modules/@paperclipai/server');
for (const entry of ['dist/index.js', 'ui-dist/index.html', 'dist/vendor/paperclip-runner/index.js', 'dist/vendor/paperclip-runner/testing.js', 'dist/vendor/paperclip-runner/live/index.js', 'dist/vendor/paperclip-runner/bin/paperclip-runnerd', 'dist/vendor/paperclip-eval-kernel/index.js', 'dist/vendor/paperclip-eval-kernel/LICENSE']) {
  if (!statSync(resolve(serverRoot, entry)).isFile()) throw new Error(`Missing release payload: ${entry}`);
}
if (!(statSync(resolve(serverRoot, 'dist/vendor/paperclip-runner/bin/paperclip-runnerd')).mode & 0o111)) throw new Error('Vendored runnerd is not executable');
const vendor = resolve(serverRoot, 'dist/vendor/paperclip-eval-kernel');
const provenance = JSON.parse(readFileSync(resolve(vendor, 'PROVENANCE.json'), 'utf8'));
if (provenance.package !== '@paperclipai/paperclip-eval-kernel' || provenance.license !== 'MIT' || !provenance.files?.['index.js']) throw new Error('Invalid eval kernel provenance');
for (const [name, hash] of Object.entries(provenance.files)) {
  if (!inside(vendor, resolve(vendor, name))) throw new Error('Invalid provenance path');
  if (createHash('sha256').update(readFileSync(resolve(vendor, name))).digest('hex') !== hash) throw new Error(`Eval kernel hash mismatch: ${name}`);
}
const freePort = () => new Promise((yes, no) => { const s = createServer(); s.on('error', no); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => yes(port)); }); });
const port = await freePort(), dbPort = await freePort();
const home = resolve(fixture, 'home'), configPath = resolve(home, 'config.json');
writeFileSync(configPath, JSON.stringify({ $meta: { version: 1, updatedAt: new Date().toISOString(), source: 'configure' }, database: { mode: 'embedded-postgres', embeddedPostgresDataDir: dataDir, embeddedPostgresPort: dbPort, backup: { enabled: false } }, logging: { mode: 'file', logDir: resolve(home, 'logs') }, telemetry: { enabled: false }, updates: { checkEnabled: false }, server: { host: '127.0.0.1', port, deploymentMode: 'local_trusted', exposure: 'private' } }));
Object.assign(process.env, { HOME: home, PAPERCLIP_HOME: home, PAPERCLIP_CONFIG: configPath, HOST: '127.0.0.1', PORT: String(port), PAPERCLIP_DEPLOYMENT_MODE: 'local_trusted', PAPERCLIP_TELEMETRY_DISABLED: '1', PAPERCLIP_ANNOUNCEMENTS_ENABLED: 'false', PAPERCLIP_DB_BACKUP_ENABLED: 'false', HEARTBEAT_SCHEDULER_ENABLED: 'false', PAPERCLIP_MIGRATION_PROMPT: 'never', PAPERCLIP_MIGRATION_AUTO_APPLY: 'true', PAPERCLIP_UI_DEV_MIDDLEWARE: 'false', SERVE_UI: 'true', PAPERCLIP_STORAGE_LOCAL_DIR: resolve(home, 'storage'), PAPERCLIP_SECRETS_MASTER_KEY_FILE: resolve(home, 'master.key') });
for (const name of ['DATABASE_URL', 'DATABASE_MIGRATION_URL', 'NODE_OPTIONS', 'NODE_PATH']) if (process.env[name]) throw new Error(`Unsafe inherited environment: ${name}`);
// Initialize only this brand-new marked fixture, without starting PostgreSQL.
// Exec sandboxes may not permit the package's default /tmp Unix socket; use
// loopback TCP exactly as the disposable MiMouse fixture does. Resolve the
// bundled dependency from the installed DB package, never a workspace issuer.
if (readFileSync(resolve(fixture, '.fixture-marker'), 'utf8') !== plan.marker || existsSync(dataDir)) throw new Error('Refusing unmarked or reused DB fixture');
const dbRequire = createRequire(resolve('node_modules/@paperclipai/db/package.json'));
const embeddedEntry = realpathSync(dbRequire.resolve('embedded-postgres'));
if (!inside(process.cwd(), embeddedEntry)) throw new Error('Embedded PostgreSQL escaped installed consumer');
const { loadWithoutCoordinatedShutdownSignalHooks } = await import(pathToFileURL(resolve(serverRoot, 'dist/shutdown.js')).href);
const { default: EmbeddedPostgres } = await loadWithoutCoordinatedShutdownSignalHooks(() => import(pathToFileURL(embeddedEntry).href));
const { prepareEmbeddedPostgresNativeRuntime } = await import('@paperclipai/db/embedded-postgres-native');
await prepareEmbeddedPostgresNativeRuntime();
const fixturePostgres = new EmbeddedPostgres({ databaseDir: dataDir, user: 'paperclip', password: 'paperclip', port: dbPort, persistent: true,
  initdbFlags: ['--encoding=UTF8', '--locale=C', '--lc-messages=C'], onLog: line => console.log(String(line)), onError: line => console.error(String(line)) });
await fixturePostgres.initialise();
const postgresConfig = resolve(dataDir, 'postgresql.conf');
if (realpathSync(dataDir) !== dataDir || realpathSync(postgresConfig) !== postgresConfig || existsSync(resolve(dataDir, 'postmaster.pid'))) throw new Error('Unexpected initialized fixture state');
appendFileSync(postgresConfig, "\n# Isolated smoke: loopback TCP only; no shared Unix socket.\nunix_socket_directories = ''\n");
const { startServer } = await import('@paperclipai/server');
const app = await startServer();
let shutdownResolved = false;
try {
  // Prove the actual database, not only intended config, belongs to this fixture.
  const postgres = (await import('postgres')).default;
  const sql = postgres(app.databaseUrl, { max: 1 });
  try {
    const [row] = await sql`SHOW data_directory`;
    if (realpathSync(row.data_directory) !== realpathSync(dataDir)) throw new Error('Actual database data_directory escaped fixture');
  } finally { await sql.end({ timeout: 5 }); }
  const base = `http://127.0.0.1:${app.listenPort}`;
  let ready = false;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const health = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(10_000) });
    if (health.ok && (await health.json()).status === 'ok') { ready = true; break; }
    await new Promise(r => setTimeout(r, 500));
  }
  if (!ready) throw new Error('Health did not return status=ok');
  const ui = await fetch(base, { signal: AbortSignal.timeout(10_000) });
  if (!ui.ok || !(await ui.text()).includes('<html')) throw new Error('Packaged UI unavailable');
  if (plan.apiPath) {
    const response = await fetch(base + plan.apiPath, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`API smoke ${plan.apiPath}: ${response.status}`);
    await response.json();
  }
} finally { await app.shutdown(); shutdownResolved = true; }
finishOwnedSmoke({ shutdownResolved, httpListening: app.server.listening,
  databasePidPresent: existsSync(resolve(dataDir, 'postmaster.pid')),
  resources: process.getActiveResourcesInfo(),
  diagnose: teardown => writeSync(2, `Installed smoke teardown: ${JSON.stringify(teardown)}\n`),
  writeReceipt: teardown => writeFileSync(resolve(fixture, 'PASS.json'), JSON.stringify({
    installedPackages: plan.packages, dataDirectory: dataDir, health: true, ui: true, apiPath: plan.apiPath ?? null,
    build: JSON.parse(readFileSync(resolve(serverRoot, 'dist/build-info.json'), 'utf8')), teardown,
  }, null, 2)),
  exit: code => process.exit(code),
});
