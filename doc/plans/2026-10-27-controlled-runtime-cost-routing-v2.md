# Controlled runtime cost routing v2

Date: 2026-10-27. Status: implementation contract; local inert C2 validation only.

## Version and scope

The v1 cost-routing preview stays read-only and blocked. Its reports are not
upgraded into dispatch authority. V2 is a distinct, default-OFF feature with one
company policy head and monotonically increasing generations. No missing row,
legacy report, or environment omission enables routing.

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
| `POST /prepare` | Immutable proposal and server-derived candidate snapshots |
| `POST /policies/:policyId/approve` | Human-confirmed digest and generation CAS; no wake |
| `POST /disable` | Generation CAS clears future policy use; no wake or cancellation |
| `POST /tasks` | Explicit new task creation, candidate selection and durable binding in one transaction; no wake |
| `POST /bindings/:bindingId/run` | Separately confirmed execution/possible charges; one owned wake intent |
| `GET /requests/:requestId` | Session-scoped metadata recovery; never execution or replay |

Task creation and execution are different approvals. Task text is ordinary task
content, not copied private trial material. Pending browser recovery retains only
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

Request IDs are bounded, company-scoped, digest-bound and actor/session-scoped.
Repeat calls cannot change payload or target. Readback is permitted while the
company is paused, as is disabling future routing. Preparation, approval, task
creation and execution remain gated. Authentication changes require fresh
readback, not replay of old confirmations.

All-null readback means **unknown**, not failed. An authoritative receipt or a
proven persisted generation advance or already-claimed binding is required before
clearing uncertainty. Clock-only approval expiry does not prove permanent closure:
GET stays read-only and returns unknown unless a durable monotone fact closes the
request. A future explicit closure mutation would need its own persisted fence.
A lost response cannot authorize another wake or a new request ID.
Withdrawal invalidates future use; it does not cancel an in-flight process,
reverse billed costs, or restore an old policy/application automatically.

## Storage, ownership and verification

New tables: `runtime_routing_policies`, `runtime_routing_receipts`,
`runtime_routing_heads`, and `runtime_routing_bindings`. Scoped foreign keys and
unique request/generation/task/run constraints supplement transactional authority
checks. `agent_wakeup_requests` has an unconditional terminal-inclusive partial
unique fence for `runtime-cost-routing:%` intents. V1 tables are unchanged.

Shared validators, schema and this design are one review unit; the integration
owner generates migration SQL/journal. Runtime, proof producer/qualifier, and UI
workers own their respective layers. No worker weakens security to make an
unsupported profile qualify.

The direct Node contract suite is `scripts/test-runtime-cost-routing-contracts.mjs`
(run with the repository's installed `tsx` loader). It covers default OFF,
strict input boundaries, decimal precision, evidence identity/coverage, scoped
recovery and schema fences without opening a database or executing a CLI.
Integration must additionally test real producer parsing with inert output,
current-authority/drift rejection, pause/disable, before-wake binding, concurrency,
unknown response recovery and zero duplicate wake. No C3/C4, paid vendor call,
full ordinary-tools quality, or deployment readiness is claimed by these checks.
