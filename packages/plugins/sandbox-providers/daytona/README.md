# `@paperclipai/plugin-daytona`

Published Daytona sandbox provider plugin for Paperclip.

This package lives in the Paperclip monorepo, but it is intentionally excluded from the root `pnpm` workspace and shaped to publish and install like a standalone npm package. That lets operators install it from the Plugins page by package name without introducing root lockfile churn for Daytona's SDK dependencies.

## Install

From a Paperclip instance, install:

```text
@paperclipai/plugin-daytona
```

The host plugin installer runs `npm install` into the managed plugin directory, so transitive dependencies such as `@daytonaio/sdk` are pulled in during installation.

## Configuration

Configure Daytona from `Instance Settings -> Environments`, not from the plugin's plugin page.

- Put the Daytona API key on the sandbox environment itself.
- When you save an environment, Paperclip stores pasted API keys as company secrets.
- `DAYTONA_API_KEY` remains an optional host-level fallback when an environment omits the key.
- Optional `apiUrl` and `target` settings map directly to the Daytona SDK/client configuration. If `apiUrl` is omitted, the Daytona SDK uses its default endpoint.

Notes:

- The current published Daytona SDK package is `@daytonaio/sdk`.
- The driver supports both `snapshot`-based and `image`-based sandbox creation. If both are set, validation rejects the config as ambiguous.
- Each cold create uses a unique provider name and ownership labels. If creation fails after Daytona has allocated a sandbox, the driver looks up that exact name, checks every ownership label, and waits for deletion. Failed, missing, or timed-out lookups and failed deletions report unconfirmed cleanup with the provider name; they never return a usable lease. A missing name lookup after an uncertain create is not proof that a delayed provider request cannot create a resource.
- For plugin-backed sandbox lease acquisition, unresolved creation cleanup crosses the worker RPC as a validated ownership envelope. The host records `pending_cleanup` before retrying deletion. If only a creation name is known, the provider first returns an ownership-verified sandbox ID without deleting it. The host saves that observation before authorizing deletion. Its existing cleanup sweep and durable spool preserve retries across controller restarts and environment deletion. A missing observed ID confirms cleanup after a lost deletion reply or database update; a name that has never been observed remains unresolved. Provider exceptions and resolved credentials are excluded from that envelope. This requires the matching host and plugin SDK update; probe and custom-image interactive-setup calls still report unconfirmed immediate cleanup without this lease-recovery path.
- Reusable leases map to Daytona stop/start semantics. Non-reusable leases are deleted on release. A provider-resolved `target` does not change the identity of an existing sandbox. Release closes the same scoped lease that a later sentinel-verified resume reopens.
- A session log socket can close while its command still runs. The driver requires a recorded command exit before returning a completed execution. It reconnects the log stream once, then polls status and log snapshots at most once per second. Replayed output is removed by byte offset, new output continues to reach the host, and the command is never dispatched again. A socket that delivers no output for 15 seconds switches directly to polling, even if the socket stays open or its initial connection never completes. Late callbacks from that socket are ignored. This recovers pending permission requests and cancellation results from saved output without replaying the command. Healthy initial and reconnected streams retain their existing lifetime under the caller’s RPC/run guard. After a clean close or an idle socket, each status or snapshot read gets a fresh operation timeout; successful recovery polling does not impose a new command lifetime. When both stream attempts fail without a clean close, fallback retains its original timeout budget starting after the stream attempts.
- The SDK returns full log snapshots, so fallback bandwidth grows with retained output; it has no paged snapshot or stream cancellation API. A recovery-read timeout keeps partial output and explicitly reports whether command exit remains unconfirmed; it does not prove the remote command stopped. Provider/session teardown remains responsible for closing an outstanding socket. A final snapshot reconciles bytes missed by the stream before returning a recorded exit.
- A sandbox record can survive the loss of its underlying container. Resume treats it as expired only when a fresh provider read confirms the exact missing-container error for that sandbox and marks it unrecoverable. Unknown errors and failed confirmation reads preserve the lease. The host still requires a verified native-runner backup before replacement.

## Local development

```bash
cd packages/plugins/sandbox-providers/daytona
pnpm install --ignore-workspace --no-lockfile
pnpm build
pnpm test
pnpm typecheck
```

These commands assume the repo root has already been installed once so the local `@paperclipai/plugin-sdk` workspace package is available to the compiler during development.

## Native Windows host transfers

The host and remote sandbox use different filesystem contracts. Remote commands
still require the provider's POSIX environment. On a native Windows host, private
download and compression staging directories receive a protected owner-only NTFS
ACL before any payload is written. File downloads keep that ACL through atomic
promotion. Directory archives are first extracted into a new private directory
on the destination volume, with archive ACL/xattr restoration disabled. The
complete staged tree and destination paths are checked before installing the
first member. Incoming files retain their private ACL through atomic promotion;
existing ordinary workspace directories keep their own ACL and untouched files.
Existing host symlink/junction parents are refused. Unavailable ACL inspection or
a non-private staged file fails closed. POSIX mode bits alone do not prove NTFS
privacy. Windows-incompatible member/link syntax (including backslashes, drives,
alternate data streams, reserved device names and trailing-dot/space aliases)
is refused before extraction. Tar hardlink targets are anchored at the archive
root, while symlink targets are relative to the link's parent.

The Node-only `src/private-filesystem-permissions.ts` is a controlled copy of
`packages/shared/src/private-filesystem-permissions.ts`. Its test checks exact
source equality, so security fixes must update both copies. This preserves the
plugin's standalone dependency graph.

Local POSIX sandbox tests use Git Bash on Windows. Tests requiring POSIX directory
mode enforcement or filenames containing `>` require a real POSIX filesystem;
their platform skips do not constitute a passed remote journey. Host malicious
archive admission is tested separately with raw USTAR bytes. Root workspace
typechecking does not include this independently installed package, and mocked
provider tests do not prove live Daytona credentials or the installed npm package.

## Package layout

- `src/manifest.ts` declares the sandbox-provider driver metadata
- `src/plugin.ts` implements the environment lifecycle hooks
- `paperclipPlugin.manifest` and `paperclipPlugin.worker` point the host at the built plugin entrypoints in `dist/`
