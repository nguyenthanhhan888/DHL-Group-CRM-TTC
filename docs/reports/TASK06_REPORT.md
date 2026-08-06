# TASK 06 — Customer and Kiosk Management

## Summary

Customer and Kiosk management now follows `BUSINESS_RULES.md` for ownership,
duplicates, lifecycle, history preservation, and aggregate totals.

The database is authoritative for rules that must not be bypassed:

- Customers and Kiosks cannot be hard deleted.
- Customer status is limited to `Active`/`Inactive`.
- Kiosk status is limited to `Pending`/`Active`/`Expired`/`Suspended`.
- Every Kiosk requires a numeric Facebook ID.
- Duplicate Kiosk Facebook IDs are blocked with transaction-scoped locking.
- `customers.total_kiosks` is maintained after Kiosk creation/reassignment.
- Customer reassignment requires explicit confirmation and a reason.
- Pending payments follow a reassigned Kiosk; completed and terminal payment history
  remains attached to its historical customer.

## Files changed

- `src/services/KioskService.js`
- `src/components/CustomerForm.js`
- `src/components/KioskForm.js`
- `src/components/KioskEditForm.js`
- `src/pages/KiosksPage.js`
- `supabase/migrations/20260726130000_protect_customer_kiosk_management.sql`
- `TASK06_REPORT.md`

Customer/Kiosk pages and services not listed above were reviewed but did not require
changes.

## Database logic

Migration:

`supabase/migrations/20260726130000_protect_customer_kiosk_management.sql`

Created:

- Permission-aware Customer/Kiosk authorization helper.
- Customer and Kiosk hard-delete protection triggers.
- Customer and Kiosk status validation triggers.
- Race-safe Kiosk Facebook-ID validation/duplicate trigger.
- Automatic `total_kiosks` synchronization trigger.
- Guard that prevents direct Kiosk owner changes.
- `reassign_kiosk_customer()` RPC:
  - requires authentication and configured Kiosk permission;
  - requires explicit confirmation and a reason;
  - locks the Kiosk and both customers;
  - moves Pending payments to the new customer so later confirmation remains valid;
  - preserves Completed, Rejected, and Cancelled payments unchanged;
  - changes Kiosk ownership;
  - refreshes old/new customer kiosk counts through the trigger;
  - records an audit entry;
  - executes atomically.
- `recalculate_customer_kiosk_totals()` RPC:
  - requires Admin or both configured Customer and Kiosk permissions;
  - recalculates `total_kiosks` from Kiosks;
  - recalculates `total_paid` only from Completed payments with `confirmed_at`;
  - recalculates Kiosk `total_paid` from the same revenue rule;
  - records an audit entry;
  - is explicit and is not executed automatically by the migration.

The migration contains no production-data rewrite, hard delete, cascade, or
destructive schema operation.

## CRUD and UI changes

- Customer creation/editing covers all mutable fields, including Facebook group
  link.
- Customer phone and Facebook-name duplicates remain warnings with an explicit
  continue/cancel choice; they are not treated as unique identifiers.
- The Kiosk create/edit form covers owner, Facebook name/ID/link/group link,
  business type/category, status, service dates, auto-approval, and note.
- Aggregate and system fields remain database-managed and are not manually editable.
- The main Kiosk “Add” action now opens the complete CRUD form.
- Adding a Kiosk from Customer Detail continues to use the selected existing
  Customer and never creates a second Customer.
- Both Kiosk creation paths require a numeric Facebook ID.
- Both Kiosk creation/editing paths perform early duplicate checks, while the
  database trigger remains the authoritative race-safe blocker.
- Duplicate Kiosk Facebook names show warnings and allow Admin to continue.
- Reassignment displays a confirmation prompt and requires a written reason.
- Existing loading, error, empty, and success Toast states were retained; new save
  paths use the same states.
- Existing deactivate/reactivate and suspend/reactivate actions remain
  non-destructive.
- No Customer/Kiosk delete action was introduced.

## History and totals

- No payment record is deleted.
- Completed payment ownership is not rewritten during Kiosk reassignment.
- Pending payment ownership is realigned with the Kiosk so `confirm_payment()` does
  not encounter a Customer/Kiosk mismatch.
- Existing payment triggers continue to maintain `total_paid`.
- The new Kiosk trigger maintains `total_kiosks`.
- The explicit recalculation RPC provides a safe repair mechanism for pre-existing
  cache drift without making the migration alter production records automatically.

## Tests performed

- JavaScript syntax checks passed:
  - `src/services/KioskService.js`
  - `src/components/CustomerForm.js`
  - `src/components/KioskForm.js`
  - `src/components/KioskEditForm.js`
  - `src/pages/KiosksPage.js`
- `git diff --check` passed.
- Static database assertions passed for:
  - both hard-delete blockers;
  - valid Customer/Kiosk status sets;
  - mandatory numeric Kiosk Facebook ID;
  - advisory-lock duplicate protection;
  - automatic kiosk-count synchronization;
  - explicit reassignment confirmation;
  - Pending payment realignment;
  - Completed payment preservation;
  - configured role-permission checks;
  - revenue-consistent total recalculation;
  - absence of frontend/database `service_role`;
  - absence of automatic production-data rewrites.
- Source scan found no Customer/Kiosk hard-delete service or UI action.
- Reviewed:
  - Customer create/edit and duplicate warnings;
  - Kiosk create/edit and duplicate blocking;
  - adding a Kiosk to an existing Customer;
  - Active/Inactive Customer transitions;
  - valid Kiosk status transitions;
  - owner reassignment confirmation and audit behavior;
  - empty/loading/error/success states;
  - preservation of payment history.

## BLOCKED items

- The migration was not applied and database integration tests were not run. This
  workspace has no Supabase CLI/local database runtime, and production data was not
  used for testing.
- Supabase database advisors could not be run without a CLI or connected project
  tool.
- Existing cache drift was not changed automatically. An authorized Admin can run
  `recalculate_customer_kiosk_totals()` after deployment and review.

## Remaining risks

- The current UI can submit ordinary Kiosk field edits and a reassignment together.
  Reassignment itself is atomic, but the ordinary field update and reassignment are
  two service calls. If reassignment fails after the field update, the non-owner
  field edits may already be saved.
- The trigger-based uniqueness guard safely serializes all future Kiosk writes but
  does not clean pre-existing duplicate Facebook IDs. Existing duplicates should be
  reviewed before adding a physical unique index.
- The add-Kiosk-from-Customer flow also creates a Pending payment through the
  existing registration workflow. Its cross-record atomicity belongs to that
  workflow and was not changed in this Customer/Kiosk-scoped task.

## Git diff --stat

Implementation files excluding this report:

```text
 src/components/CustomerForm.js                                  |   9 +-
 src/components/KioskEditForm.js                                 |  44 +++++-
 src/components/KioskForm.js                                     |  18 ++-
 src/pages/KiosksPage.js                                         |   6 +-
 src/services/KioskService.js                                    |  53 +++++--
 supabase/migrations/20260726130000_protect_customer_kiosk_management.sql | 382 +++
 6 files changed, 495 insertions(+), 17 deletions(-)
```

The migration and report are untracked, so ordinary `git diff --stat` does not show
them until they are added to Git. No commit or push was performed.
