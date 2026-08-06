# TASK 08 — Staff and Permissions

## Summary

Staff administration is now Admin-only at the route, Edge Function, RPC, and
database-policy layers.

Admins can:

- create Reviewer accounts;
- edit Reviewer name, username, and email;
- activate and deactivate Reviewers;
- reset Reviewer passwords with a six-character minimum.

Staff hard deletion has been removed. Deactivation preserves Auth, role, approval,
payment, and audit history.

## Files changed

- `src/app.js`
- `src/constants/roles.js`
- `src/pages/PermissionsPage.js`
- `src/pages/StaffPage.js`
- `src/services/AuthService.js`
- `src/services/PermissionService.js`
- `src/services/StaffService.js`
- `supabase/functions/manage-staff/index.ts`
- `supabase/config.toml`
- `supabase/migrations/20260726150000_secure_staff_permissions.sql`
- `TASK08_REPORT.md`

No unrelated business module was modified.

## Security changes

### Staff Edge Function

`manage-staff` now:

- requires gateway JWT verification in `supabase/config.toml`;
- verifies the bearer token again with `auth.getUser()`;
- accepts only active users whose database role is exactly `admin`;
- no longer grants staff administration to the hard-coded Support role;
- rejects browser requests from origins outside the configured allowlist;
- obtains its privileged client key only from server-side
  `SUPABASE_SECRET_KEY`/`SUPABASE_SECRET_KEYS`;
- no longer references the legacy service-role environment variable;
- never sends a privileged key to the frontend;
- rejects the legacy `delete` action and instructs Admin to deactivate;
- sets a long Auth ban when deactivating a Reviewer;
- removes the ban when reactivating;
- rolls the Auth ban state back if the database status update fails;
- validates six-character minimum passwords for create and reset;
- records create, edit, reset-password, activate, and deactivate actions;
- includes actor UUID/name/type/role and target record ID in audit events;
- never places a password in audit `before`, `after`, `reason`, or other log data.

Authorization does not use editable `user_metadata`. The optional managed role
stored in `app_metadata` is descriptive only; database `user_roles` remains the
authorization source.

### Staff history

- The staff Delete button and handler were removed.
- `StaffService.remove()` was removed.
- The Edge Function rejects manually crafted delete requests.
- A database trigger rejects deletion of every `user_roles` row.
- Existing staff, Auth references, approvals, payments, and audit records remain
  preserved.

### Inactive staff

- Initial application load signs out inactive staff.
- The application rechecks profile status every 30 seconds and signs out a newly
  deactivated user.
- Deactivation bans future Auth login/refresh.
- The Edge Function checks `is_active` on every request.
- Permission RPCs reject inactive users.
- Restrictive RLS permission policies reject inactive database callers even while
  an older access token remains cryptographically valid.
- Existing business RPCs continue to perform their own active-role checks.

### Reviewer permissions

Direct browser access to `user_roles` and `role_permissions` is revoked.

Created database RPCs:

- `get_current_staff_profile()`
- `get_my_permissions()`
- `get_role_permissions_admin()`
- `update_reviewer_permissions()`
- `has_active_permission()`

Rules:

- Reviewer permissions are read from the existing `role_permissions` table.
- Only an active Admin can read another role’s configuration or update Reviewer
  permissions.
- Only known application permissions are stored.
- `staff` and `permissions` are never returned to non-admin users, even if stale
  configuration contains them.
- Permission changes are written to canonical `audit_logs`.
- The frontend Permission page uses the Admin RPC rather than direct upsert.

### Route and database protection

- Reviewer navigation is generated from current configured permissions.
- Detail routes inherit their parent permission:
  - Customer Detail → Customers
  - Kiosk Detail → Kiosks
  - Payment Detail → Payments
- Reviewer default routing selects the first allowed page.
- Reviewers with no permissions are signed out with a clear message.
- Support navigation no longer includes Staff.
- Support defaults to Dashboard rather than an inaccessible Staff route.
- Reviewer permissions are refreshed during the session; revoked routes redirect.

Restrictive RLS guards were added to:

- customers;
- kiosks;
- payments;
- categories;
- business types;
- registration requests;
- settings.

The guards require an active Admin or the matching configured permission for both
row visibility and mutations. This prevents a user from bypassing hidden buttons
and calling the Data API directly.

## Audit changes

The following actions are logged without passwords:

- Reviewer created;
- Reviewer profile edited;
- Reviewer password reset;
- Reviewer activated;
- Reviewer deactivated;
- Reviewer permission configuration updated.

Each client staff action supplies a non-secret business reason. Actor identity is
resolved by the standardized audit layer.

## Tests performed

- JavaScript syntax checks passed:
  - `src/app.js`
  - `src/constants/roles.js`
  - `src/pages/PermissionsPage.js`
  - `src/pages/StaffPage.js`
  - `src/services/AuthService.js`
  - `src/services/PermissionService.js`
  - `src/services/StaffService.js`
- `git diff --check` passed.
- Static Edge Function assertions passed for:
  - Admin-only authorization;
  - active-profile validation;
  - six-character password minimum on create and reset;
  - no staff-delete implementation;
  - explicit delete rejection;
  - server secret-key configuration;
  - JWT verification configuration;
  - strict origin handling;
  - deactivate/reactivate Auth ban handling;
  - all four audit payloads excluding passwords.
- Static migration assertions passed for:
  - active Admin enforcement;
  - active-user permission lookup;
  - Admin-only permission changes;
  - audited permission changes;
  - immutable staff-role history;
  - restrictive database permission policies;
  - direct role-table access revocation.
- Source scans confirmed:
  - no Staff delete button;
  - no `StaffService.remove`;
  - no frontend `service_role`;
  - Auth and Permission services no longer query role tables directly.

## BLOCKED items

- The migration and Edge Function were not deployed.
- Database integration tests were not run because this workspace has no local
  Supabase CLI/database runtime.
- Deno is not installed, so `deno check` and local Edge Function execution could not
  be run.
- Supabase database advisors could not be run without a CLI or connected project.
- Deployment must configure `SUPABASE_SECRET_KEY` or `SUPABASE_SECRET_KEYS` before
  replacing the existing Edge Function. The removed legacy environment variable is
  intentionally not used.

## Remaining risks

- Supabase access tokens remain valid until expiry after deactivation. Auth banning,
  30-second UI revalidation, Edge checks, RPC checks, and restrictive RLS prevent
  new authorized actions, but token revocation timing still follows Supabase Auth
  behavior.
- Auth Admin changes and audit inserts cannot share one PostgreSQL transaction. If
  an audit insert fails after an Auth operation, the function returns an error but
  the Auth change may already exist. This requires an outbox/retry architecture for
  a stronger cross-system guarantee.
- The very long `ban_duration` must be verified against the deployed
  `supabase-js`/GoTrue version during Edge deployment.
- Restrictive Task 08 policies are designed to combine with existing permissive
  policies. The deployed policy set should be reviewed with Supabase advisors after
  migration.
- Existing sessions receive permission updates on the next 30-second refresh.
  Database enforcement is immediate.

## Git diff --stat

Implementation files excluding this report:

```text
 src/app.js                                                |  68 +++++++-
 src/constants/roles.js                                    |   2 +-
 src/pages/PermissionsPage.js                              |   6 +-
 src/pages/StaffPage.js                                    |  25 ---
 src/services/AuthService.js                               |   6 +-
 src/services/PermissionService.js                         |  36 ++--
 src/services/StaffService.js                              |  26 ++-
 supabase/functions/manage-staff/index.ts                  |  72 ++++----
 supabase/config.toml                                      |   2 +
 supabase/migrations/20260726150000_secure_staff_permissions.sql | 295 +++
 10 files changed, 433 insertions(+), 105 deletions(-)
```

The configuration, migration, and this report are untracked, so ordinary
`git diff --stat` does not include them until they are added to Git. No commit or
push was performed.
