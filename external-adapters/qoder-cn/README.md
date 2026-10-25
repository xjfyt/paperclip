# Qoder CN external adapter

Local package loaded through Paperclip's existing external-adapter installation. The package root exports createServerAdapter; no core run enums change. Install the reviewed local directory `external-adapters/qoder-cn` using the existing external adapter configuration; see upstream docs/adapters/external-adapters.md. Do not enable it until CLI version, account and workspace access are verified.

Configuration: executablePath (default qodercn), cwd (absolute assigned workspace), configRoot (absolute isolated configuration parent), accountId (stable non-secret identity), maxTurns (1–100), timeoutSec (<=3600), allowedTools. Credentials use the existing secret-backed env.QODERCN_PERSONAL_ACCESS_TOKEN. The default permission mode does not bypass approval. The adapter does not implement dynamic tool approval; permission-requiring calls may block/fail and must not be described as supported.

Identity includes company, Agent, real workspace, account and task. It never resumes the most recent session. Configuration is stored under a SHA-256-derived identity directory; exclusive lock files prevent concurrent reuse. A stale lock requires operator reconciliation of provider termination, not automatic deletion. Only local Linux-style process-group stop is tested. Windows, remote workspaces, live provider cancellation and skill synchronization are not qualified.

Output is bounded; terminal result and successful process exit are both required. Errors and cancellation are not reported as success. Spawn and proven stopped-group callbacks use the upstream context. Token usage scope is unverified and retained as metadata, not silently billed. Credits are session-cumulative, never summed per result and never treated as USD. Unknown monetary cost remains unpriced. A worktree is not a security sandbox.

Run `node --test external-adapters/qoder-cn/test/*.test.mjs` from the repository root. Tests use real child processes but a fake CLI, not real Qoder inference. C2 protocol work is not C3/C4 account/task acceptance.

References verified 2026-10-25:
- https://docs.qoder.cn/cli/cli-reference
- https://docs.qoder.cn/cli/sdk/cost-usage

## Runtime qualification (2026-10-25)

The official npm compatibility package `@qodercn-ai/qoderclicn@1.1.78` was installed in an isolated cloud test directory. Its actual `--version`, `--help`, and argument-validation behavior were checked without logging in or sending a model request. This release hides `--max-turns` from help; diagnostics verify its rejecting parser using an intentionally invalid count plus `--help`, never by launching a task. Per-run settings disable automatic CLI updates; production should pin and requalify its chosen native or npm installation. This is CLI availability evidence, not account or model-task acceptance.

A stable task key is mandatory (runtime taskKey, then explicit taskId/issueId fallback); otherwise execution refuses before dispatch. The fake-CLI suite includes an actual descendant process-group stop and session identity changes.

Official installation source: https://docs.qoder.cn/cli/installation

## Opt-in lifecycle hello probe

`allowHelloProbe` defaults to false. Version/help diagnostics alone do not satisfy the host's authenticated lifecycle gate. An operator may explicitly enable a minimal model probe, which can consume credits and can be repeated by lifecycle retries. It uses a fresh scratch directory, one turn, bounded output, no tools, strict MCP, no external settings sources, no session persistence and an exact random nonce. Success requires both the expected response and confirmed process termination; unknown termination retains the scratch directory for reconciliation. Real model probing was not authorized or run in this development environment.

The 17-test fake-CLI suite covers this contract and credential-fingerprint session isolation. An actual local Paperclip HTTP/DB test installs the package, creates an Agent and task, passes its lifecycle probe using a fake CLI, invokes a heartbeat and verifies the resulting successful run/receipt. It is C2 integration, not a real Qoder account task or full Agent tool/JWT acceptance.

New identity directories are created owner-only (0700), and run locks use 0600. Existing shared, foreign-owned or symlinked identity directories are rejected before dispatch; the adapter does not silently chmod existing user directories. Operators should use a new private configRoot or review and repair ownership/permissions themselves before recovery.
