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
The canonical `prepare-bundled-package.mjs` producer handles patches and platform
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
paths. Before success it queries `SHOW data_directory` and checks the canonical
path against the fixture, waits for `/api/health` status `ok`, fetches packaged UI,
and optionally GETs the requested API path. It shuts down the server and database;
the parent also terminates the isolated process group on timeout/failure. Never
point it at an existing database. Nothing is deleted automatically: retain the
printed fixture path, resolution trace and `PASS.json` for review.

Offline install failure, missing PostgreSQL/sharp/native payload, root-user
PostgreSQL refusal, vendor mismatch, startup failure, or timeout is a **failed**
smoke. Never replace such a failure with a metadata-only green result. No
production service, fixed port, real account, registry publication, or external
provider run is required.
