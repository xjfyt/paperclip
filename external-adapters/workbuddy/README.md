# Paperclip WorkBuddy external adapter

Experimental server-led cloud-task adapter. This package uses only the internal Paperclip API; provider OAuth tokens remain in an owner-bound encrypted integration vault, outside generic company-secret bindings. See `doc/mimouse/workbuddy.md` in the fork for deployment, protocol and verification boundaries.

Run `node --test test/*.test.mjs`. Configure an owner-authorized `connectionId`, the server `PAPERCLIP_API_URL`, and a stable task identity. The run must carry a valid Agent JWT whose responsible owner matches the connection owner, and the owner must explicitly allow this Agent. This adapter does not provision permissions.

The request identity survives lost responses and new run IDs. Resume queries the same job, never blindly recreates an uncertain cloud task. A provider-completed report is still not business acceptance. Costs remain unpriced. Confirmed remote cancellation, workspace synchronization, unattended tool approvals and live tenant qualification are not supported claims. The real upstream loader is covered by package tests; installation permissions and real OAuth still require deployment qualification.

Agent lifecycle verification is performed by the server after an explicit owner grant. It verifies required scopes and a minimal read-only task-list request, without creating a remote task. Existing run-token signing must be configured. The standalone package diagnostic remains a warning because it cannot independently prove the private grant. After migration 0338, legacy connections require fresh owner OAuth and Agent grants; old unbound jobs require reconciliation, not automatic replay.
