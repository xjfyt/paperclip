# Capability evidence ledger integration — 2026-10-26

## Integration manifest (central files intentionally not edited)

1. Export `capabilityEvidence` from `packages/db/src/schema/index.ts` from `./capability_evidence.js`.
2. Allocate the next migration number for `doc/integration/capability-evidence.sql`, register the migration journal/snapshot through the normal DB workflow. SQL includes immutable UPDATE/DELETE enforcement; do not omit its trigger. No DB has been started or migrated by this contribution.
3. In `server/src/app.ts` import `capabilityEvidenceRoutes` from `./routes/capability-evidence.js` and mount `api.use(capabilityEvidenceRoutes(db))` next to company skill policy routes. Optional routes index export uses the same name. Shared contract uses existing wildcard subpath exports (`@paperclipai/shared/capability-evidence`), no package edits needed.
4. Mount `<CapabilityEvidenceLedger companyId={agent.companyId} adapterType={agent.adapterType} />` alongside, not instead of, `MimouseAdapterCapabilities` on AgentDetail. Limit to qoder_cn/workbuddy; ledger endpoint requires company admin, including reads. Non-admins may retain the baseline-only panel; do not treat a failed admin ledger request as a verified status.
5. Run `node scripts/compose-mimouse-locales.mjs` centrally to compose `capabilityEvidence/{en,zh-CN,ja,es}.json`. No generated locale edited here.
6. Integrator must run typecheck, DB migration/replay and real transaction tests, route ACL tests, UI tests and browser checks after wiring. Pure doubles below are not PostgreSQL lock/concurrency proof.

## API and evidence semantics

GET `/api/companies/:companyId/capability-evidence?afterRevision=0` returns at most 100 immutable events plus `nextRevision`. Continue until null; an incomplete history cannot establish active evidence. POST the same endpoint accepts this shape:

```json
{
  "expectedRevision": 0,
  "idempotencyKey": "00000000-0000-4000-8000-000000000001",
  "action": "record",
  "reason": "verification",
  "receipt": {
    "adapterType": "qoder_cn", "capability": "localExecution",
    "runtime": "qoder", "runtimeVersion": "1.0.0",
    "environmentAlias": "staging", "accountAlias": "test-account",
    "testedCommit": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "level": "C3", "result": "passed",
    "sourceResourceId": "resource-alias", "sourceRunId": "run-alias",
    "testedAt": "2026-10-26T00:00:00Z", "expiresAt": "2026-10-27T00:00:00Z"
  }
}
```

Example only, not a real receipt. Supply actual authorized test metadata and current times, never secrets. C3/C4 are **operator attestations**, not independently authenticated provider evidence. Reviewer identity and record time come from server auth/clock; reported test time, runtime, account and external source identifiers remain operator claims. This API performs no probes or remote verification and accepts no uploads, arbitrary text, URLs or credentials. Alias syntax/known-secret-pattern rejection reduces accidental exposure but cannot establish that arbitrary opaque text is non-secret; operators must use neutral aliases. Audit details exclude receipt contents.

Revocation uses `action: revoke`, `targetId`, no receipt, and a bounded reason enum. Supersession uses `action: supersede`, `targetId`, and replacement receipt with the identical context; a new version/account/environment/commit needs a new record. Both preserve prior records. A company-row lock serializes append/CAS/idempotency; immutable event and minimal audit insert commit or roll back together. Exact retry by the same actor returns the original event even if the ledger advanced. Reuse with changed content/actor conflicts. Stale revision conflicts require refresh and deliberate resubmission with a new key, never blind revision changes.

The UI is an administrator inspection/revocation panel. Recording and superseding are available through the strict administrator API, not a free-text UI editor. Revocation retries reuse the same key; errors remain visible. Company changes remount confirmation state. History and recorded context remain visible; active display is never execution permission. Expiration schedules a render to fail closed without user refresh. External revocations require refresh; no claim of realtime verification is made.

C2 baseline is a code-owned allowlist matching existing fixture evidence. Unknown/unsupported cannot gain implementation via attestation. Latest failed/blocked/expired/revoked evidence does not fall back to older passes. Missing exact runtime/version/environment/account/commit match fails closed. No dispatch, adapter configuration, or runtime permission reads this ledger.

The append-only table intentionally blocks physical company deletion while evidence exists, rather than silently destroying audit history. Retention/purge requires a separately governed future migration; no deletion endpoint is provided.

## Verification scope

Pure Vitest single worker / 512 MB: shared contract and transactional service doubles, including isolation, unsupported capability, exact context, expiry/future time, revocation/supersession, bounded fields, CAS, idempotency and simulated audit rollback. No DB/server/build/install or external account used. Logs: `/tmp/capability-ledger-pure.log`; token gate log `/tmp/capability-ledger-token-gates.log`. Full integration validation remains pending with parent to avoid concurrent heavy work.
