# Isolated all-dist installation smoke

`server/dist/index.js` run inside the workspace is **not** an installation test:
its `@paperclipai/*` dependencies can still resolve `src/*.ts` through workspace
exports. This smoke produces real tarballs and installs them in a fresh consumer.
It does not modify workspace manifests, links, builds, or databases.

After the normal release builds finish, run serially (Node 24.11+ and npm):

```sh
node --test scripts/dist-install-smoke.test.mjs
node scripts/dist-install-smoke.mjs \
  --source /absolute/path/to/built-checkout \
  --scratch /absolute/path/to/disposable-scratch-parent \
  --cache /absolute/path/to/existing/npm-cache \
  --api-path /api/companies
```

The smoke implementation and source manifests must match. It never builds or
fetches from the network: npm uses offline mode (the standard registry URL is retained for npm cache keys),
scripts disabled, empty npmrc files, and an allowlisted environment. A pnpm store
is **not** an npm cache. An incomplete npm cache must fail, not silently fall back
to workspace node_modules or online fetching. Populate an authorized cache in a
separate step if required; do not copy credentials into the fixture.

The server's complete release-enabled first-party dependency closure is selected
using `release-package-map.mjs`, including optional and peer edges. Private runner
and evaluation packages must remain vendored, not become npm runtime dependencies.
As in the release version-rewrite step, all disposable package manifests get
the server version before packing; mixed source versions (for example SDK1.0.0
versus server0.3.1) must not generate nonexistent runtime edges. Source manifests
remain untouched. The canonical `prepare-bundled-package.mjs` producer handles patches and platform
optional-dependency delegation. Other packages use its
`materializePublishManifest` helper before scripts-disabled npm packing. As in
`release.sh`, root skills are copied to server/Claude/Codex staging directories;
server UI staging may reuse built `ui/dist`. Missing optional `files` entries are
omitted as npm does; missing compiled `dist` or packaged UI is an error.

The installed consumer has no workspace links. Node resolution hooks reject any
runtime import escaping it, all executable TypeScript, and first-party source or
shim paths. Installed metadata is checked for private/unpublished workspace edges
and unmaterialized publish exports. The runner entry points/native executable and
the evaluation kernel license/provenance hashes must be present. This is a server
installation smoke, **not** a CLI/onboarding/provider execution or cross-platform
qualification test. A host-incompatible runnerd or missing native dependencies
can still require separate provider qualification.

Startup runs the staged server with plain Node (no tsx), a fresh explicitly marked
fixture, fresh embedded PostgreSQL, loopback ephemeral ports, telemetry/update
checks/announcements/heartbeat scheduling disabled, and isolated home/storage/key
paths. Before startup, only the newly marked fixture is initialized using the
installed DB package's bundled PostgreSQL and native-runtime helper. Its
`postgresql.conf` gets `unix_socket_directories = ''` for sandbox-safe loopback
TCP; existing cluster state, pid files and symlinked config paths are refused.
No agent/provider executable is invoked by the harness. Before success it queries `SHOW data_directory` and checks the canonical
path against the fixture, waits for `/api/health` status `ok`, fetches packaged UI,
and optionally GETs the requested API path. It awaits the exported server shutdown, verifies the HTTP listener is closed and
the database pid file absent, records only public `process.getActiveResourcesInfo()`
resource types, then explicitly exits its owned process. The exported shutdown
API intentionally does not exit its caller; the CLI signal path does. The receipt
labels natural process exit **not verified**, and remaining resource types must
not be presented as full natural quiescence or used to dismiss a product leak.
The parent also terminates the isolated process group on timeout/failure. Never
point it at an existing database. Nothing is deleted automatically: retain the
printed fixture path, resolution trace and `PASS.json` for review.

Offline install failure, missing PostgreSQL/sharp/native payload, root-user
PostgreSQL refusal, vendor mismatch, startup failure, or timeout is a **failed**
smoke. Never replace such a failure with a metadata-only green result. No
production service, fixed port, real account, registry publication, or external
provider run is required.

The canonical bundled producer receives `sourceRoot` pointing at the built
checkout, not the partial staging tree. It reads that checkout's root
`package.json`, `packages/paperclip-runner/acpx-profiles.json`, and configured
patch files; only package payload and install/patch outputs go to the fixture.
These inputs need not be copied or guessed in staging.

## Explicit online cache preparation

If the offline consumer reports `ENOTCACHED`, separately authorize downloading
public dependencies, then run:

```sh
node scripts/prepare-dist-smoke-cache.mjs \
  --source /absolute/path/to/current-checkout \
  --scratch /absolute/path/to/disposable-scratch-parent \
  --cache /absolute/path/to/existing/npm-cache
```

Use a disk-backed scratch parent/cache on memory-constrained hosts; `/tmp` may
be tmpfs and large native tarballs would consume the build memory budget. Existing
cached metadata/tarballs are preferred, while missing entries still use the
official registry through existing routing.

This metadata-only fixture enumerates the canonical server release closure,
resolves each declared external edge separately with strict
`npm install --package-lock-only --ignore-scripts`, and
caches official npm-registry tarballs compatible with this host in batches of at
most four. Each batch is checked offline first; only missing content is fetched
with prefer-offline semantics. It does
not install node_modules, run package lifecycle scripts, build code, start the
server/database, or invoke agent/provider executables. Direct-version
variants get separate metadata fixtures, never a merged dependency union or
synthetic dev-only dependency names. The canonical producer's qualified
bridge/runtime override is retained for its exact pinned edge. Peer-resolution
conflicts are recorded as incomplete branches, without force or legacy-peer
resolution. `CACHE-COVERAGE.json` reports successes and unresolved branches. This is
cache warming, not proof that the offline install/start smoke will pass.

The helper preserves **existing** proxy routing and CA environment variables
unchanged. It does not print their values, obtain credentials, create alternative
proxies/certificates, or disable TLS checks. Empty separate user/global npmrcs and
an allowlisted environment keep authentication and unrelated runtime settings out.
Dropping an existing proxy or `NODE_EXTRA_CA_CERTS` during sanitization can produce
misleading DNS/certificate failures. Restore only already-provisioned configuration;
never bypass a policy denial or security warning. Downloads stop at the first
failure, without alternate registries or rerouting. The offline smoke's strict
runtime environment remains unchanged.
