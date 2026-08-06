# TASK 07 — Logs and Audit

## Summary

The application now uses `audit_logs` as its single canonical audit source.
The legacy `logs` table is retained intact for historical compatibility, copied
idempotently into `audit_logs`, and mirrored into the canonical table if an older
database function writes another legacy row.

Actor attribution is now database-owned. The frontend no longer caches a profile,
guesses a person, or substitutes a guessed System actor.

## Audit review findings

### Previous `AuditLogService`

- Wrote directly to `audit_logs` from the browser.
- Loaded the current profile asynchronously into module state.
- Could write a real staff operation as `System` when the profile had not loaded.
- Trusted browser-supplied actor fields.
- Performed filters and pagination through direct table access.

### Previous `LogService`

- Queried the separate legacy `logs` table.
- Used a schema different from `audit_logs`.
- Had no unified actor type or reliable staff-name resolution.

### Database writers

- Newer payment/registration/customer-kiosk RPCs write `audit_logs`.
- An older payment function still writes `logs`.
- Edge staff management writes `audit_logs` with a concrete actor UUID.
- Existing database operations used inconsistent module/entity/record conventions.

## Files changed

- `src/services/AuditLogService.js`
- `src/services/LogService.js`
- `src/pages/LogsPage.js`
- `supabase/migrations/20260726140000_standardize_audit_logs.sql`
- `DATABASE.md`
- `TASK07_REPORT.md`

No unrelated business page, workflow, or service was modified.

## Migration changes

Migration:

`supabase/migrations/20260726140000_standardize_audit_logs.sql`

### Canonical schema

Added to `audit_logs`:

- `actor_type`
- `entity`
- `record_id`
- `legacy_log_id`

The canonical audit record now contains:

- actor UUID when known;
- actor name;
- actor type (`staff`, `public`, `system`, `database_trigger`);
- configured role;
- action;
- module;
- entity;
- record ID;
- before snapshot;
- after snapshot;
- reason;
- database timestamp.

### Actor attribution

The insert-normalization trigger:

- uses `auth.uid()` when a request has an authenticated user;
- resolves Admin/Reviewer names and roles from `user_roles`;
- resolves a concrete actor UUID supplied by a trusted database/Edge writer;
- displays anonymous registrations as `Public User`;
- displays an explicitly marked trigger as `Database Trigger`;
- displays operations without a concrete actor as `System`;
- never displays an unverified supplied person for a null actor UUID;
- derives entity and record ID from the event when omitted;
- supplies an explicit “reason not provided” value for future events.

The read RPC joins `user_roles`, so current Admin and Reviewer display names are
shown correctly while the stored name remains a historical fallback.

### Legacy history

- Existing `logs` rows are copied into `audit_logs`.
- `legacy_log_id` makes the copy idempotent.
- No legacy row is deleted or updated.
- Future inserts into `logs` are mirrored automatically.
- `LogService` is retained only as a compatibility wrapper over
  `AuditLogService`; it no longer queries `logs`.

### Integrity and access

- `audit_logs` and `logs` have RLS enabled.
- Direct table privileges are revoked from `PUBLIC`, `anon`, and `authenticated`.
- Updates and deletes are rejected by immutable-log triggers.
- Normal users cannot modify or delete historical logs.
- `write_audit_log()` is available only to authenticated active staff and derives
  the actor in PostgreSQL.
- `get_audit_logs()` and `get_audit_log()` require Admin or the existing configured
  `logs` permission.
- All public security-definer RPCs use an empty search path, fully-qualified
  objects, explicit revokes, and explicit grants.

### Database-side querying

`get_audit_logs()` performs:

- actor/name/role/type filtering;
- module filtering;
- action filtering;
- start-time filtering;
- exclusive end-time filtering;
- general search;
- newest-first stable ordering;
- total count;
- offset/limit pagination.

Allowed page sizes remain 10, 25, and 50.

## Service and UI changes

### `AuditLogService`

- Removed `AuthService` initialization and cached actor state.
- Writes through `write_audit_log()`.
- Reads through `get_audit_logs()` and `get_audit_log()`.
- Normalizes empty values, dates, result arrays, counts, and pagination.

### `LogService`

- Now delegates to the canonical `AuditLogService`.
- Preserves its existing public method names for compatibility.

### Logs page

- Added actor filter.
- Added start and end date filters.
- Existing module, action, search, pagination, loading, empty, and error states are
  preserved.
- Detail view now displays actor type, entity, and record ID.

## Documentation

`DATABASE.md` now documents:

- `audit_logs` as the canonical immutable source;
- the standardized actor/action/entity schema;
- RPC-based access and database pagination;
- the retained legacy `logs` compatibility strategy;
- current staff-name resolution from `user_roles`.

## Tests performed

- JavaScript syntax checks passed:
  - `src/services/AuditLogService.js`
  - `src/services/LogService.js`
  - `src/pages/LogsPage.js`
- `git diff --check` passed.
- Static migration assertions passed for:
  - canonical actor/entity/record columns;
  - idempotent legacy preservation;
  - future legacy mirroring;
  - immutable `audit_logs`;
  - immutable legacy `logs`;
  - actor resolution from `auth.uid()`;
  - Admin/Reviewer profile-name resolution;
  - Public User, System, and Database Trigger attribution;
  - null actors never displaying a guessed person;
  - reason fallback;
  - database-side actor/module/action/time filters;
  - database-side limit/offset pagination;
  - RLS and revoked direct access;
  - absence of historical delete/truncate SQL;
  - absence of frontend `service_role`.
- Source scan confirmed the two log services no longer query either table directly
  and no longer use cached frontend actor data.

## BLOCKED items

- The migration was not applied and integration queries were not run against a
  database. This workspace has no Supabase CLI/local database runtime, and
  production audit history was not used for testing.
- Supabase database security/performance advisors could not be run without a CLI or
  connected project.
- Exact legacy-row import counts cannot be reported until the migration runs.

## Risks

- Some existing business services perform their business mutation and subsequent
  `write_audit_log()` call as two browser requests. Actor attribution and log
  integrity are fixed, but a network failure between those requests can still leave
  an unaudited direct-table mutation. Moving those remaining mutations into
  transactional business RPCs should be handled within each business module.
- Historical `audit_logs` rows with no actor UUID cannot be safely attributed to a
  person. They intentionally display as System (or Public User when the old role
  proves it was public) rather than guessing.
- The legacy import assumes the `logs` columns currently used by the repository
  (`old_data`, `new_data`, `old_value`, `new_value`, `created_by`) exist in the
  deployed schema. This must be verified during migration deployment.
- JSON snapshots can contain sensitive business fields. Access is permission
  restricted, but retention/redaction policy still requires a product decision.

## Git diff --stat

Implementation files excluding this report:

```text
 DATABASE.md                                                   |  44 +++--
 src/pages/LogsPage.js                                         |  67 ++++++
 src/services/AuditLogService.js                               | 134 ++++++------
 src/services/LogService.js                                    |  64 ++----
 supabase/migrations/20260726140000_standardize_audit_logs.sql | 483 +++
 5 files changed, 666 insertions(+), 126 deletions(-)
```

The migration and this report are untracked, so ordinary `git diff --stat` does not
include them until they are added to Git. No commit or push was performed.
