# TASK 10 — Final CRM QA and Remaining Fixes

## Final conclusion

**NOT READY**

The repository implementation is materially closer to the business rules and all
linked frontend modules now load in the static runtime smoke test. However, the
connected production Supabase project has not received any of the Task P0-01
through Task 10 schema/RPC/security migrations. The deployed database still exposes
the legacy revenue, registration, approval, trigger, role, and audit architecture.

Production deployment must not proceed until the migrations are applied to a
staging/branch database, the database test matrix below passes, the Edge Function is
deployed with its server secret, and authenticated Admin/Reviewer browser tests
pass.

## Tests performed

### Repository and frontend

- Read `BUSINESS_RULES.md` and all required Task P0-01 through Task 09 reports.
- Ran `node --check` for every JavaScript file under `src`; passed.
- Linked and imported the complete `src/app.js` dependency graph; passed after
  fixing two missing named exports/imports.
- Render-smoked Dashboard, Reports, Customers, Kiosks, Payments, Payment Detail,
  Customer Detail, Kiosk Detail, Public Registration, Legacy Registration,
  Approval, Staff, Permissions, Logs, Settings, and Login pages; passed.
- Tested shared empty/invalid date normalization; returns `—`.
- Tested shared Facebook Group ID configuration and URL generation; passed.
- Ran `git diff --check`; passed.
- Confirmed no old embedded Facebook Group ID remains in `src` or migrations.
- Confirmed no `service_role`, `SUPABASE_SERVICE_ROLE`, or frontend secret reference
  exists in `src` or Supabase SQL/Edge source.
- Confirmed Customer, Kiosk, Payment, and Staff services contain no hard-delete
  call.
- Confirmed Reports contains no 20,000-row/raw-report cap or aggregation fetch.
- Confirmed public, legacy, and existing-customer Kiosk registration services each
  call one transactional RPC.
- Statically asserted the Dashboard, Reports, and Payment database sources require:
  `Completed` plus non-null `confirmed_at`.
- Statically asserted approval uses `confirm_payment()`, rejection uses
  `reject_payment()`, and the legacy aggregate/payment triggers are retired.
- Browser automation was attempted, but no in-app/Chrome browser backend was
  available. Visual/interactive tests therefore remain manual deployment gates.

### Read-only connected Supabase QA

Project inspected: `DC A day roi (DHL)`. No schema or data mutation was performed.

- PostgreSQL: 17.6.
- Latest deployed repository migration: `20260722150752`.
- None of the migrations dated `20260725*` or `20260726*` are deployed.
- The production database currently has only the legacy:
  - `confirm_payment(bigint)`;
  - `approve_registration_request(bigint)`;
  - `reject_registration_request(bigint,text)`.
- Production does not yet have the new Dashboard, Reports, payment workflow,
  atomic registration, audit, staff-permission, settings, or final compatibility
  RPCs.
- Current source-data checks:
  - Customers: 200
  - Kiosks: 224
  - Payments: 199
  - Eligible Completed payments: 198
  - Lifetime recognized revenue: 207,750,000
  - Current-year recognized revenue: 204,750,000
  - Current-month recognized revenue: 28,670,000
  - Completed without `confirmed_at`: 0
  - Customer `total_paid` mismatches: 0
  - Customer `total_kiosks` mismatches: 0
  - Duplicate Kiosk Facebook IDs: 0
  - Kiosks without customer: 0
  - Kiosks without Facebook ID: 2
  - Invalid non-positive Completed payments: 0
  - Duplicate Pending registration-request Facebook IDs: 0
- Current payment statuses are 198 Completed and 1 Cancelled. There is no current
  Pending fixture, so Pending exclusion was verified by code/SQL contract rather
  than a live Pending record.
- Production schema/security inspection found:
  - legacy `ON DELETE CASCADE` from `user_roles` to `auth.users`;
  - legacy `on_kiosk_change` total-count trigger;
  - legacy `trg_payment_success` payment aggregate/service trigger;
  - legacy anonymous `submit_registration_request()` still executable;
  - an anonymous direct Kiosk read policy used by the separate extension;
  - leaked-password protection disabled;
  - three mutable-search-path advisor warnings;
  - missing indexes on registration-request foreign keys.
- Supabase API logs show the currently deployed frontend still issuing old
  Dashboard/Reports queries based on `start_date` and raw table reads. This is
  expected because the new frontend/database release has not been deployed, but it
  confirms production revenue is not yet using the new source of truth.

## Bugs fixed during final QA

1. **Public Registration module failed to load**
   - `RegisterPage` imported a non-existent named `supabase` export.
   - Fixed it to use the shared required Supabase client.

2. **Application module graph failed to load**
   - `PaymentDetailPage` imported a non-existent `formatDateTime`.
   - Added the safe shared formatter and removed the unused import.

3. **Settings/logout notifications threw at runtime**
   - They called the `Toast` object as a function.
   - Updated them to use `Toast.show()`.

4. **Public and Legacy Registration bypassed shared settings**
   - Both migrations embedded a separate Facebook Group ID.
   - They now resolve `settings.facebook_group_id`; no guessed fallback remains.

5. **Approval was incompatible with the new payment workflow**
   - The repository had no replacement approval migration, while the deployed
     legacy RPC creates duplicate Customer/Kiosk/Payment rows and invokes the old
     completion path.
   - Added `approve_registration_request()` and
     `reject_registration_request()` replacements that lock the request, resolve
     one linked Pending payment, call the authoritative payment RPC, update the
     request, and audit in one transaction.
   - Added `registration_requests.payment_id` with a restrictive foreign key and
     automatic link for new requests.

6. **Legacy anonymous registration bypass remained**
   - The old `submit_registration_request()` could remain callable beside the new
     atomic public RPC.
   - The final migration revokes it after verifying the function exists.

7. **Legacy triggers would conflict with authoritative triggers**
   - `on_kiosk_change` and `trg_payment_success` would execute alongside Task 03/06
     triggers and duplicate/overwrite totals or service state.
   - The compatibility migration drops those two trigger bindings without deleting
     history.

8. **Existing-customer Kiosk creation was not atomic**
   - The frontend separately created a Kiosk and Pending payment.
   - Added `submit_existing_customer_kiosk()` and changed the service to one RPC.
     It validates permissions/package/Facebook ID, creates the Pending Kiosk and
     payment, and audits atomically.

9. **Reconciliation incorrectly flagged valid negative adjustments**
   - Completed negative adjustment rows were treated as invalid payment amounts.
   - Reconciliation now permits non-zero adjustment deltas while retaining strict
     positive standard-payment validation.

10. **Staff FK violated the no-cascade rule**
    - Production has `user_roles_user_id_fkey ON DELETE CASCADE`.
    - The final migration replaces it with `ON DELETE RESTRICT`.

11. **Settings permission/UI mismatch**
    - Reviewer and Support could receive a Settings route that the Admin-only
      settings RPC rejects.
    - Settings was removed from non-Admin defaults and Reviewer-configurable
      permissions.

12. **Confirmed advisor/index issues**
    - Added registration-request FK indexes used by approval/report operations.
    - Fixed the search path of the two existing stats functions when present.

## Business-rule verification

- Revenue sources in Dashboard, Reports, Payments, total synchronization, and
  reconciliation all use Completed plus non-null `confirmed_at`.
- Revenue month/year bounds are half-open business-timezone ranges.
- Pending, Rejected, and Cancelled rows do not enter revenue or paid totals.
- Confirmation alone activates/renews Kiosk service.
- Public Registration, Legacy Registration, approval, and add-Kiosk-to-existing
  Customer are database transactions.
- Customer and Kiosk hard deletes are blocked by triggers.
- Every Payment hard delete is blocked; Completed financial fields are immutable.
- Kiosk Facebook ID writes are normalized, locked, and duplicate-blocked.
- `total_paid` and `total_kiosks` are database-maintained and have an audited
  recalculation RPC.
- Admin/Reviewer checks are enforced by RPC/RLS/Edge logic, not just hidden buttons.
- Settings and staff administration are Admin-only.
- Audit rows are immutable and database-owned after migration.

## Remaining blockers

1. **All Task migrations are undeployed.** Production remains on the old business
   rules and security model.
2. **SQL migrations have not been executed as a complete sequence in a disposable
   database.** The workspace has no Supabase CLI or `psql`, and no development
   branch was created.
3. **Authenticated browser E2E is incomplete.** No browser backend was available,
   and the new RPCs are absent from production.
4. **Edge Function validation is incomplete.** Deno is unavailable; the updated
   `manage-staff` function has not been type-checked or deployed.
5. **Two existing Kiosks have no Facebook ID.** The migration does not rewrite
   production data. They must be reviewed manually before editing or enforcing a
   physical unique/not-null constraint.
6. **No live Pending/Rejected/adjustment fixtures were created.** Production data
   was intentionally not mutated for QA.

## Remaining security risks

- Production currently permits anonymous direct Kiosk reads for the separate Chrome
  extension. This was not modified because TTC/Wallet/Coin/Chrome Extension work is
  explicitly excluded. Review the exposure separately before declaring the overall
  Supabase project secure.
- Supabase leaked-password protection is disabled and should be enabled in Auth
  settings.
- The `pg_trgm` extension is installed in `public`; Supabase Advisor recommends a
  dedicated extension schema.
- Staff Auth changes and database audit writes span Auth and PostgreSQL systems and
  cannot be one database transaction; a post-Auth audit failure remains possible.
- Public registration requires external rate limiting/WAF protection.
- Historical audit JSON may contain sensitive business values; retention/redaction
  policy remains a product/security decision.
- Database `SECURITY DEFINER` functions intentionally exposed to authenticated
  users will continue to appear in generic Advisor warnings. Each must be
  rechecked after deployment for explicit grants, fixed search path, and internal
  authorization.

## Required Supabase deployment steps

1. Take a database backup and record a restore point.
2. Create a Supabase development branch/staging clone.
3. Apply migrations in exact order:
   - `20260725120000_create_role_permissions_table.sql`
   - `20260725130000_create_audit_logs_table.sql`
   - `20260725140000_create_settings_table.sql`
   - `20260725150000_create_dashboard_data_rpc.sql`
   - `20260725160000_create_reports_data_rpc.sql`
   - `20260726100000_create_payment_workflow.sql`
   - `20260726110000_create_public_registration_rpc.sql`
   - `20260726120000_create_legacy_registration_rpc.sql`
   - `20260726130000_protect_customer_kiosk_management.sql`
   - `20260726140000_standardize_audit_logs.sql`
   - `20260726150000_secure_staff_permissions.sql`
   - `20260726160000_secure_organization_settings.sql`
   - `20260726170000_fix_registration_approval.sql`
4. Run Supabase security and performance advisors; review every new warning.
5. Run the full database fixture matrix below on staging.
6. Configure server-only `SUPABASE_SECRET_KEY` or `SUPABASE_SECRET_KEYS`.
7. Deploy `manage-staff` with JWT verification enabled.
8. Configure the Edge Function production-origin allowlist.
9. Populate official organization settings, especially
   `official_group_name` and `facebook_group_id`.
10. Review the two existing Kiosks without Facebook IDs.
11. Run `recalculate_customer_kiosk_totals()` with a documented reason and verify
    that it reports/produces no unintended changes.
12. Deploy the frontend only after the database and Edge Function are ready.
13. Repeat advisors, read-only aggregate checks, API/Edge/Postgres log review, and
    the manual browser matrix after deployment.

## Required manual tests

### Authentication and permissions

- Admin login/logout confirmation, refresh, expired session, inactive Admin.
- Reviewer with each configurable permission and with no permissions.
- Direct REST/RPC attempts by anon, inactive staff, Reviewer without permission,
  Reviewer with permission, and Admin.
- Reviewer cannot access Staff, Permissions, or Settings by URL or RPC.
- Password create/reset at 5 and 6 characters; deactivate/reactivate session.

### Dashboard and Reports

- Empty tables return zeros/empty states without NaN/null/undefined.
- Same date range produces identical Dashboard/Report/Payment revenue.
- Completed at exact month/year lower and upper boundaries.
- Pending, Rejected, Cancelled, and Completed-without-confirmation fixtures.
- Reports filters, allowed page sizes, sorting, pagination, reconciliation, and
  page-limited export.
- Negative adjustment appears in revenue but not as invalid reconciliation data.

### Customer, Kiosk, Payment, and approval

- Customer/Kiosk create/edit/status transitions and duplicate warnings.
- Duplicate and concurrent Facebook ID creation attempts.
- Add Kiosk to existing Customer and force a payment insert failure to verify full
  rollback.
- Reassign Kiosk with/without confirmation and reason.
- Attempt hard delete of Customer, Kiosk, every Payment status, and staff history.
- Pending edit, confirm, duplicate confirm, reject, cancel, adjustment.
- Active renewal and expired renewal boundaries.
- Confirm total/service state is unchanged by Pending/Rejected/Cancelled.
- Approval and rejection update the linked request and payment atomically without
  creating a duplicate Customer or Kiosk.

### Registration, logs, settings, and UI

- Public single/multi-Kiosk registration, bill types/size, duplicate phone warning,
  duplicate Facebook blocking, and forced rollback.
- Legacy new/existing/ambiguous Customer and multi-Kiosk rollback.
- Actor names for Admin/Reviewer; System/Database Trigger for non-user writes.
- Audit filters and pagination; direct audit update/delete rejection.
- Settings validation, audit, shared group URLs, and warning-day propagation.
- Loading, error, retry, success, and empty states on every page.
- Mobile sidebar: overlay, Escape, toggle-close, route-close, logout cancel/confirm.
- Desktop navigation at supported widths.
- Browser console and network panel contain no module errors, unhandled rejection,
  failed RPC, secret, or service-role credential.

## Git diff --stat

Repository-wide tracked diff at report creation:

```text
42 files changed, 2452 insertions(+), 2019 deletions(-)
```

This stat includes the accumulated uncommitted work from prior tasks. Plain
`git diff --stat` does not include untracked reports, configuration, shared config
files, or migrations until staged. No files were staged, committed, pushed, or
deployed.
