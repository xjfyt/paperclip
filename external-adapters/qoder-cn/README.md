# Qoder CN external adapter

Local package loaded through Paperclip's existing external-adapter installation. The package root exports createServerAdapter; no core run enums change. Install the reviewed local directory `external-adapters/qoder-cn` using the existing external adapter configuration; see upstream docs/adapters/external-adapters.md. Do not enable it until CLI version, account and workspace access are verified.

Configuration: executablePath (default qodercn), cwd (absolute assigned workspace), configRoot (absolute isolated configuration parent), accountId (stable non-secret identity), maxTurns (1–100), timeoutSec (<=3600), allowedTools. Credentials use the existing secret-backed env.QODERCN_PERSONAL_ACCESS_TOKEN. The default permission mode does not bypass approval. The adapter does not implement dynamic tool approval; permission-requiring calls may block/fail and must not be described as supported.

Identity includes company, Agent, real workspace, account and task. It never resumes the most recent session. Configuration is stored under a SHA-256-derived identity directory; exclusive lock files prevent concurrent reuse. A stale lock requires operator reconciliation of provider termination, not automatic deletion. Only local Linux-style process-group stop is tested. Windows, remote workspaces, live provider cancellation and skill synchronization are not qualified.

Output is bounded; terminal result and successful process exit are both required. Errors and cancellation are not reported as success. Spawn and proven stopped-group callbacks use the upstream context. Token usage scope is unverified and retained as metadata, not silently billed. Credits are session-cumulative, never summed per result and never treated as USD. Unknown monetary cost remains unpriced. A worktree is not a security sandbox.

Run `node --test external-adapters/qoder-cn/test/*.test.mjs` from the repository root. Tests use real child processes but a fake CLI, not real Qoder inference. C2 protocol work is not C3/C4 account/task acceptance.

References verified 2026-10-25:
- https://docs.qoder.cn/cli/cli-reference
- https://docs.qoder.cn/cli/sdk/cost-usage
