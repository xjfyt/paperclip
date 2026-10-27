# Controlled runtime cost routing v2

Date: 2026-10-27. Status: restricted-profile local C2 qualified at `752d4813`;
final integrated build/API/full-UI regression remains pending.

## Version and scope

The v1 cost-routing preview stays read-only and blocked. Its reports are not
upgraded into dispatch authority. V2 is a distinct, default-OFF feature with one
company policy head and monotonically increasing generations. No missing row,
legacy report, or environment omission enables routing. The runtime feature gate
requires `PAPERCLIP_RUNTIME_COST_ROUTING_ENABLED=true`; leave it unset/false until
qualification and an explicit operator decision. Enabling the flag, opening the
UI, preparing a pool, or approving a policy never implicitly creates or runs work.

The initial supported target is the built-in Claude local CLI using a pinned
company API-key secret and an already approved literal prompt application. Only
new, ordinary company-visible, projectless tasks with no parent, overlay, prior
session, resume, or retry are eligible. Other adapters, wrappers, engines,
workspace overrides, and credential schemes fail closed. This is not support for
all profiles, real-time cost optimization, or permission self-expansion.

## Evidence and human control

A proposed pool explicitly names every candidate Agent, prompt, application,
application generation, and historical private comparison. Each candidate must
have its **own** tested Agent/model/provider identity. Every candidate covers the
same fixed dataset/hash and scorer. Baseline/candidate comparisons remain
human-review evidence; a candidate never borrows another Agent's costs or quality.

Server-produced evidence binds prompt revision, dataset and skill version,
restricted execution profile, actual prepared context, and settled per-case
run/receipt/cost-event identities and hashes. A pre-wake configuration snapshot
or a comparison's aggregate `totalCostCents` is insufficient. The supported CLI
producer must actually emit the model and cost provenance consumed by the
qualifier; seeded fixtures alone do not establish producer reachability.

Costs are exact decimal USD cents reported by the CLI and reconciled through
settlement, **not** a verified provider invoice, reservation, or future quote.
The observed total supports ranking only among currently qualifying approved
candidates. A lower observed total does not promise the next task will cost less.
Evidence age, future timestamps, missing/duplicate cases, incomplete receipts,
model drift, context drift, and unsupported provenance reject qualification.

The accepted quality basis is `bare_text_proxy_v1` with `exact_text_v1`, explicitly
acknowledged by a human. `ordinaryToolsQualityProven`, `completeContextCaptured`,
and `futureCostQuoted` remain false. Approving a pool does not modify Agent
configuration, credentials, prompt applications, access rules, or financial
permissions. Existing budget gates remain mandatory.

## State and API contract

Base: `/api/companies/:companyId/runtime-cost-routing`.

| Operation | Effect |
| --- | --- |
| `GET /` | Current head and authorized metadata; no execution |
| `GET /policies/:policyId`, `GET /bindings/:bindingId` | Creator-authorized policy/binding metadata; no execution |
| `POST /prepare` | Immutable proposal and server-derived candidate snapshots |
| `POST /policies/:policyId/approve` | Human-confirmed digest and generation CAS; no wake |
| `POST /policies/:policyId/close-expired` | Explicit closure of an expired, never-approved proposal; no head change or wake |
| `POST /disable` | Generation CAS clears future policy use; no wake or cancellation |
| `POST /tasks` | Explicit new task creation, candidate selection and durable binding in one transaction; no wake |
| `POST /bindings/:bindingId/run` | Separately confirmed execution/possible charges; one owned wake intent |
| `GET /requests/:requestId` | Freshly authenticated creator metadata recovery; never execution or replay |

Task creation and execution are different approvals. The human explicitly
confirms the task content's ordinary company visibility, then separately confirms
execution and possible charges before running it. Task text is not copied private
trial material. Pending browser recovery retains only
IDs, hashes and action metadata, never task text, private outputs or secrets.
The binding pins the task digest; edits require a new reviewed binding rather
than silently changing the approved work.

A binding advances `bound → wake_pending → run_claimed → start_requested`.
Unique task, run, and wake-intent fences prevent duplicate starts. A current,
server-owned request/witness—not client payload flags—authorizes the dedicated
runtime path. Generic wakes cannot bypass the binding. `start_requested` is not
proof of provider input consumption, success, cost settlement or cancellation.

Before admitting and before starting a bound task, revalidate current user/session
authority, company/Agent state, budget gates, policy/application generations,
prompt identity, configuration, pinned secret version, implementation and target.
The applied prompt head must still match the tested prompt and target. Any drift
blocks; do not change configuration, silently switch candidates, or fall back to
ordinary unqualified execution.

## Recovery and withdrawal

Request IDs are bounded, company-scoped, digest-bound and creator-owned; stored
receipts record the acting session. Browser pending journals are additionally
scoped to the company, user and session. A creator's newly authenticated session
can request authorized metadata without inheriting permission to replay old
confirmations. Repeat calls cannot change payload or target. Readback is permitted
while the company is paused, as is disabling future routing. Preparation, approval, task
creation and execution remain gated. Authentication changes require fresh
readback, not replay of old confirmations.

All-null readback means **unknown**, not failed. An authoritative receipt or a
proven persisted generation advance, already-claimed binding or explicit expired
proposal closure is required before clearing uncertainty. Clock-only approval
expiry does not prove permanent closure: GET stays read-only and returns unknown
unless a durable monotone fact closes the request.

To resolve an expired generation-zero proposal without unsafe retry, the human
can explicitly POST `close-expired` with its expected generation. Under the same
head → policy lock order, DB time must be at/after expiry and the proposal must
never have an approval receipt. The only permitted update is the one-way
`approvalClosedAt: null → DB timestamp`; immutable input/evidence, the company
head, permissions and approved policies do not change. Repeating the same
policy/generation closure is idempotent. Database constraints and the migration's
immutability trigger enforce the lifecycle exception. The original pending
approval request can then read the marker as `approval_expired`, without another
request journal or any wake. A lost response cannot authorize another wake or
a new approval request ID.
Withdrawal invalidates future use; it does not cancel an in-flight process,
reverse billed costs, or restore an old policy/application automatically.

## Storage and retention

New tables: `runtime_routing_policies`, `runtime_routing_receipts`,
`runtime_routing_heads`, and `runtime_routing_bindings`. Scoped foreign keys and
unique request/generation/task/run constraints supplement transactional authority
checks. `agent_wakeup_requests` has an unconditional terminal-inclusive partial
unique fence for `runtime-cost-routing:%` intents. V1 tables are unchanged.

The binding foreign keys intentionally prevent physical deletion of referenced
issues, Agents and heartbeat runs. Prefer archive/retirement controls that retain
the evidence, not direct row deletion or disabling constraints. Policy withdrawal
also retains the historical decision and receipt chain.

The company-deletion service now removes the new v2 dependents in order:
bindings → heads → receipts → policies, before their referenced company objects.
The new policy/receipt immutability guards reject updates, except the narrowly permitted expiry
marker, but do not introduce a blanket DELETE trigger that blocks this cleanup.
This fixes the new v2 cleanup dependency; it does **not** resolve pre-existing
legacy DELETE-trigger debt or prove complete company deletion across all older
histories. Keep that limitation visible rather than bypassing legacy guards.

## Migration 0359 and operational preparation

`0359_confused_kid_colt.sql` is additive but requires a maintenance window. Before
applying it, leave the feature OFF, drain application/worker writes, and take a
restorable database backup with the deployment's normal backup procedure. Preserve
the migration journal and verify recovery prerequisites before making changes.
The existing wake-request uniqueness scan is not online/concurrent DDL; bounded
lock and statement timeouts are not a promise of uninterrupted service.

If migration application fails or times out, keep routing OFF and inspect the
transaction outcome and migration history before retrying. Do not delete evidence,
remove triggers, or relax constraints to force a pass. Disabling the feature is a
runtime rollback for future work, not a database downgrade, process cancellation,
or refund. Production rollout still requires migration/backup verification and
the integration checks below.

## Ownership and verification limits

Shared validators, schema and this design are one review unit; the integration
owner generates migration SQL/journal. Runtime, proof producer/qualifier, and UI
workers own their respective layers. No worker weakens security to make an
unsupported profile qualify.

The direct Node contract suite is `scripts/test-runtime-cost-routing-contracts.mjs`
(run with the repository's installed `tsx` loader). It covers default OFF,
strict input boundaries, decimal precision, evidence identity/coverage, scoped
recovery and schema fences without opening a database or executing a CLI.

### Qualified local C2, not a vendor or complete-regression pass

The real PostgreSQL/private-heartbeat integration fixture passed **26/26** at
`752d4813` (local execution log: `/tmp/paperclip-routing-real-pg-fifth.log`). Its
entry is `server/src/services/mimouse-private-prompt-tests/integration.test.ts`,
including the routing evidence, closure and runtime DB cases. Candidate costs
come from each candidate's own private heartbeat/accounting receipt chain, not
fabricated qualifying ledger rows. Lock tests observe the actual owned backend
waiting; the budget case uses the existing budget service, a settled fixture
ledger of 0.25 USD cents and a 1-cent reservation. Those fixture amounts are not
paid vendor invoices or future task quotes.

Four earlier **25/26** attempts remain part of the record: missing explicit
configuration authority, a raw Date SQL parameter, a real checkout-phase bug,
and an inadequate budget fixture. Repairs supplied the required grant rather
than bypassing permission checks, corrected parameter encoding, enforced the
live exact-run identity while rejecting terminal replay, and replaced the budget
mock with the real policy/reservation path. The final pass does not erase those
failures or expand the supported profile.

Supporting focused checks reported for this integration are 193 related unit
tests across 10 files, 12 shared contract checks, and 59 focused UI tests. The
4280-key UI has passed full UI type checking and production build; key counts are
not coverage, and focused UI tests are **not** a full UI regression result.

At this documentation pass, the standard server build is being rerun after four
reported TypeScript errors were fixed. Two prior standalone build SIGKILLs and
the first standard-build failure remain recorded. A final successful complete
build, compiled API regression and full UI test aggregation are not yet claimed.
The final integration owner must record those results against the final input;
older full-suite snapshots cannot substitute for them.

This local C2 qualification uses inert Node/mock execution without a real model,
Claude CLI/vendor, paid service or notification recipient. It does not prove
ordinary-tool quality, complete context, production migration/backup recovery,
C3/C4 provider behavior, all-profile support, or deployment readiness. The
maintenance/backup and retention requirements above still apply. Existing
85-item status counts remain unchanged until a separate status review.
