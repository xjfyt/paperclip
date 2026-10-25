# Paperclip WorkBuddy external adapter

Experimental server-led cloud-task adapter. This package uses only the internal Paperclip API; provider OAuth tokens remain in the company's encrypted secret store. See `doc/mimouse/workbuddy.md` in the fork for deployment, protocol and verification boundaries.

Run `node --test test/*.test.mjs`. Configure an owner-authorized `connectionId`, the server `PAPERCLIP_API_URL`, and a stable task identity. The run must carry a valid Agent JWT whose responsible owner matches the connection owner, and the owner must explicitly allow this Agent. This adapter does not provision permissions.

The request identity survives lost responses and new run IDs. Resume queries the same job, never blindly recreates an uncertain cloud task. A provider-completed report is still not business acceptance. Costs remain unpriced. Confirmed remote cancellation, workspace synchronization, unattended tool approvals and live tenant qualification are not supported claims. Loader installation and real OAuth still require deployment qualification.
