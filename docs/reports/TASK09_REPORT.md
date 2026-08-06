# TASK 09 — Settings and Remaining UI Fixes

## Outcome

Task 09 is implemented without committing or pushing. Organization/contact settings now use the database-backed `settings` source, Admin updates go through a validated and audited RPC, the embedded Facebook Group ID was removed, and the mobile sidebar/logout interactions were completed.

## Files changed

- `src/pages/SettingsPage.js`
  - Added all requested organization fields and retained existing organization/system fields.
  - Added escaped values, browser validation, loading, retry, saving, success, and error states.
- `src/services/SettingsService.js`
  - Replaced direct table reads/upserts with settings RPCs.
  - Populates the shared organization-settings cache.
- `src/config/organization.js` (new)
  - Shared runtime settings store and Facebook group member URL resolver.
- `src/constants/facebook.js`
  - Removed the hardcoded Facebook Group ID.
  - Existing callers now resolve the configured ID at use time.
- `src/layouts/AppLayout.js`
  - Added a mobile sidebar overlay.
  - Made logout text explicit instead of icon-only.
- `src/app.js`
  - Loads shared public organization settings.
  - Added sidebar close via overlay, Escape, toggle, and route changes.
  - Added a logout confirmation modal and sign-out failure state.
- `src/styles/app.css`
  - Added responsive overlay styling and a clearer logout control.
- `supabase/migrations/20260726160000_secure_organization_settings.sql` (new)
  - Adds the missing organization setting keys and secure RPCs.
- `TASK09_REPORT.md`
  - Replaced the stale pre-existing Task 09 report with this task’s report.

## Settings implemented

- `official_group_name` — official group name
- `group_url` — main group URL
- `sub_group_url` — community/sub-group URL
- `recruitment_group_url` — recruitment group URL
- `fanpage_url` — official fanpage URL
- `zalo_url` — support Zalo number or URL
- `support_phone` — contact phone
- `facebook_group_id` — Facebook group ID
- `warning_days` — expiring-soon warning period
- Existing `company_info`, `business_info`, and `system_settings`

The existing keys were preserved, so the migration does not rewrite production values. The two missing keys are inserted with `ON CONFLICT DO NOTHING`.

## Database and security changes

Migration: `20260726160000_secure_organization_settings.sql`

- `get_public_organization_settings()`
  - Returns only the public contact/group allowlist.
  - Callable by `anon` and `authenticated`, enabling shared public-facing configuration without exposing internal settings.
- `get_organization_settings()`
  - Returns all existing organization settings.
  - Requires an active Admin through the existing database permission helper.
- `update_organization_settings(settings_input, reason_input)`
  - Requires an active Admin.
  - Accepts only known keys.
  - Validates required group name, HTTP(S) URLs, numeric Facebook Group ID, and warning days from 1–365.
  - Writes all supplied settings in one database transaction.
  - Records actor, before/after values, and reason in `audit_logs`.
- Direct `INSERT`, `UPDATE`, and `DELETE` on `settings` are revoked from browser roles.
- No frontend service-role key is used.
- No destructive SQL or production-data rewrite is included.

## Navigation and logout behavior

- On viewports below 900px, opening the sidebar displays an overlay.
- Clicking the overlay closes the sidebar.
- Escape closes the open sidebar first and restores focus to the toggle.
- The same toggle opens and closes the sidebar and updates `aria-expanded`/`aria-label`.
- Route navigation closes the mobile sidebar.
- Desktop sidebar layout remains fixed and the overlay stays hidden.
- Logout is labeled “Đăng xuất”, opens a confirmation dialog, supports cancellation, disables during sign-out, and reports failure without discarding the session UI.

## Tests performed

Passed:

- `node --check` for all Task 09 JavaScript files.
- `git diff --check`.
- Shared settings runtime test:
  - no configured Facebook Group ID returns no invented URL;
  - configured ID builds the expected group-member base URL;
  - legacy template-string consumers resolve the live configured value;
  - member URLs are constructed correctly.
- Source audit confirms:
  - the old embedded Group ID is absent;
  - no direct `.from('settings')` write/read remains in frontend source;
  - all requested settings keys are represented.
- Manual code-path verification for toggle, overlay, Escape, route-change close, logout cancel, logout confirm, loading, error, retry, and success states.
- SQL safety review confirms additive inserts, `ON CONFLICT DO NOTHING`, explicit RPC grants/revokes, fixed `search_path`, key allowlisting, and no delete/update of existing production values outside the explicit Admin RPC.

## Blocked items

- Database migration execution and live RLS/RPC integration tests are blocked because the Supabase CLI/local Postgres runtime is not installed in this workspace. The migration was not applied to any production environment.
- Authenticated browser end-to-end testing was not possible without applying the new RPC migration to a test Supabase project and having test Admin/Reviewer sessions.

## Remaining risks

- This migration depends on the earlier Task 07/08 migrations that provide `audit_logs` and `private.assert_active_admin()`. Migrations must be applied in timestamp order.
- Existing installations must populate `official_group_name` and `facebook_group_id` after migration. No guessed production values were seeded.
- Public organization values are intentionally readable through the allowlisted RPC; internal `company_info`, `business_info`, `system_settings`, and `warning_days` are not returned by it.
- A full device/browser matrix should be run after deployment to confirm visual behavior on the supported mobile browsers.

## Git diff --stat

The working tree already contained uncommitted changes from Tasks P0-01 through 08. Therefore the repository-wide `git diff --stat` is not isolated to Task 09:

```text
40 files changed, 2426 insertions(+), 1953 deletions(-)
```

Task 09 additionally adds two untracked implementation files (`src/config/organization.js` and the migration), which plain `git diff --stat` does not include until staged. No files were staged.
