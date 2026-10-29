# Coding delivery read boundaries

`GET /companies/:companyId/coding` retains the company-administrator gate and
strict task privacy predicate used by direct coding reads. Local/instance admins
and disabled general privacy mode do not bypass that predicate here. Authorization
is applied in SQL before the `limit` (1–100, default 100).

Optional filters are `issueId` **or** the paired `gitlabOrigin` + `projectId`.
Origins are bare HTTP(S) origins; an old single trailing slash remains readable.
No historical credential, review binding, or evidence is rewritten. A cursor is a
delivery UUID in `after`, not a timestamp or hidden-row cursor. It must still be
readable in the same company/filter. The page orders by native PostgreSQL
`created_at DESC, id DESC`; timestamp text preserves microseconds in the keyset
comparison, without a JavaScript Date round trip. An invalid, removed, hidden, or
wrong-filter cursor returns the same 404.

`projectSummary.scope = authorized_delivery_page`: counts describe only the
returned authorized page, not all project history. Equal project IDs on distinct
GitLab origins remain distinct. Missing, unknown, future, or more-than-60-second
old remote evidence cannot produce a ready code-candidate gate. This gate does
not authorize production release. Six-platform trusted admission and upload
remain blocked, independently of code-candidate counts.

Local artifact hashes use one open descriptor for initial/final `fstat` and all
reads. Byte count, device, inode, size, nanosecond mtime/ctime and final resolved
path are checked. Stable symlinks inside the root are supported; escaping links,
non-files, and changed paths are rejected. `O_NOFOLLOW` rejects a final-component
symlink swap; `O_NONBLOCK` prevents a FIFO swap hanging before `fstat`. These
checks are **not** an atomic sandbox of all ancestor directory changes, nor proof
of a platform build, test, signature, trusted provenance or upload.

Focused regressions: `mimouse-coding-artifact-races.test.ts` uses real disposable
files with deterministic operation hooks; `mimouse-coding-list.test.ts` uses a
fresh marked PostgreSQL fixture and never publishes to GitLab or runs a model.
