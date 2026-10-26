# Local feedback evidence (P3 bounded slice)

The feedback detail view adds a read-only evidence panel. GET
`/api/companies/:companyId/feedback-inbox/:id/evidence?beforeId=<uuid>`
uses the existing board/company-administrator gate. It does not inspect tasks,
promotion receipts, external traces, repositories, connectors or model output.

`redacted-error-stack-v1` reads only persisted redacted inbox text (32,000
characters, first 1,000 lines). It finds the first recognized JS/JVM-style
Error/Exception line and up to five immediately adjacent `at` stack lines,
each at most 500 characters. The fingerprint includes algorithm, company,
exact product, exact version, and trimmed selected lines. Messages, IDs,
paths and line numbers are not normalized away. This is deliberately
conservative: unsupported stack formats or changed locations can be missed.
Matching excerpts are not proof of a common root cause.

Missing, unknown or redaction-placeholder product/version metadata, missing
stack context, or redaction markers in selected lines disable grouping.
The original title-only candidates remain separate and unchanged; neither
path automatically merges records or creates tasks.

Each request scans at most 50 eligible same-product/version rows plus one
pagination sentinel. Pages are descending `(createdAt, id)`; a cursor is
resolved only inside the authorized company and evidence product/version scope.
Timestamp comparison stays inside PostgreSQL to preserve microsecond precision
(including batches whose timestamps collapse to the same JavaScript millisecond).
A missing/deleted cursor returns not-found rather than restarting traversal. Newer inserted rows cannot
shift subsequent pages; this is a live listing, not a frozen transaction
snapshot. Empty match pages can still have a next cursor. Clients must
follow that cursor to continue; no response claims an inbox-wide total.

Results contain actual excerpt line numbers and existing source event,
feedback, product/version, commit and trace references. References are
unverified identifiers, not fetched resources. Imported text is rendered
as React text, never executable markup or instructions. No source URL,
raw import, private task identifier or confirmation receipt is added.
The checklist distinguishes reference presence from verification and always
states reproduction was **not performed**. Expected behavior and regression
tests require human review. Existing human confirmation/promotion stays
unchanged; reading this panel does not imply that approval.

Integration hooks: export `FeedbackEvidence` and `FeedbackEvidencePage`
from the shared package root; regenerate locales from the four
`feedbackEvidence` contributions. No schema or migration is required.

Verification: pure helper tests cover scope separation, unknown metadata,
actual excerpts, inert instruction text, text/scan limits and no network
calls. The feedback UI suite includes inert rendering/no-reproduction
coverage. DB/auth integration, UI tests and aggregate build/typecheck must
be run by the integrating owner; helper tests alone do not verify them.

The PostgreSQL regression fixture
`mimouse-feedback-pagination.integration.test.ts` covers a 55-row microsecond
batch, a second timestamp in that same millisecond, insertion of a newer row
between pages, and company/product/version/deleted cursor rejection. It is
prepared but was not executed under the parent resource restriction.
