# Internal run-log references

This is an additive path into the existing company feedback inbox, not a new
feedback mechanism. It neither reads nor copies run-log content.

## Contract

- `POST /api/companies/:companyId/feedback-inbox/run-log-preview`: select a
  `runId` and positive safe-integer `eventSeq` already recorded by the server.
- `POST .../run-log-import`: repeat the selection, its `previewDigest`, and
  `confirm: true`. No caller-supplied task binding or source text is accepted.
- `GET .../:id/run-log-source`: revalidate the original source access and exact
  persisted reference. This returns metadata only, never a log body or URL.

The reference contains company/run/event identities and exact UTC creation
timestamps, including PostgreSQL microseconds, plus a SHA-256 reference digest.
The digest is of allowed metadata, **not log content**. The preview also binds
reviewer and session identities. Version stays `unknown`, commit stays `null`,
and reproduction stays `not_performed`. Event type, provider identifiers,
context snapshots, private issue text, log paths, messages, payloads, and
stdout/stderr are neither selected nor hashed by this service.

## Authorization and consistency

All three operations require a current authenticated human session and current
active company owner/admin membership. They repeat the canonical company and
`canActorReadHeartbeatRun` authorization using the run's durable scope/issue
binding; submitted context cannot redefine it. A company administrator role or
an imported reference does not grant access to a private originating issue.
Source checks also remove instance-admin elevation and apply the canonical issue
privacy predicate regardless of global off/shadow rollout modes. Private ancestor
and project audience rules therefore remain in force for this import path.
Other authorized feedback administrators can see the content-free candidate,
but the source endpoint independently checks the original source every time.

Confirmation re-reads metadata under shared run/event/session/membership locks
and serializes the exact company/run/sequence import using a transaction-level
advisory lock. The existing source-event unique index remains the database fence.
One first import writes one candidate and one content-free audit entry in the
same transaction. Replays recheck authorization and digest; replaced event IDs
or changed timestamps cannot reuse the old identity. These tests cover revocation
between requests, not linearizability against a concurrent ACL mutation after the
final privacy read; ACL rows are not locked by this feature. No notification,
plugin event, provider request, execution, or reproduction is dispatched.

Internal records use `application_log` and server-only source instance
`internal.run-log.v1`, with `manual_import` indicating the explicit human import.
The ordinary manual endpoint rejects the reserved `internal` namespace. No
schema migration, historical backfill, automatic ingestion, or source access
expansion is included.

## UI and verification

The dialog requires preview and explicit confirmation. Company/user/session
changes and closing/reopening invalidate attempts at commit time. A changed
selection clears preview/confirmation, retries retain the exact attempted
payload, and repeated clicks cannot dispatch concurrent requests. Delayed old
responses cannot update a newer dialog, selection, or identity. Local copy has
English, Chinese, Spanish, and Japanese resources; identifiers/user text are not
translated.

Focused suites: `mimouse-feedback-run-log.test.ts`,
`mimouse-feedback-run-log.integration.test.ts`, and
`MimouseFeedbackRunLog.test.tsx`. The integration suite uses a newly allocated
PostgreSQL database and controlled HTTP requests; it never starts an agent.
