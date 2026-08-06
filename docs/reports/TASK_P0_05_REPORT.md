# TASK P0-05 — Legacy Registration

## Root cause

Legacy Registration performed customer lookup, optional customer creation, kiosk
creation, and payment creation as independent frontend requests. A failure after any
successful request left partial records, and the commented-out cleanup could not
provide a transaction or safely delete business data.

The old path also:

- inserted a `Completed` payment directly instead of using the payment confirmation
  workflow;
- marked the kiosk Active before payment confirmation;
- used a non-unique phone lookup without detecting ambiguous matches;
- checked Facebook duplicates before the write without concurrency protection;
- supported only one kiosk;
- did not create a dedicated Legacy Request or one atomic audit record.

## Files modified

- `src/services/LegacyRegistrationService.js`
- `src/pages/LegacyRegistrationPage.js`
- `supabase/migrations/20260726120000_create_legacy_registration_rpc.sql` (new)
- `TASK_P0_05_REPORT.md` (new)

Existing Dashboard, Reports, Public Registration, Payment workflow, customer CRUD,
kiosk CRUD, and production data were not modified.

## Migration and RPC created

### `public.legacy_registration_requests`

A new private table records the historical request independently from the current
service period:

- customer, kiosk, and pending-payment references;
- requested historical start/end dates;
- supplied legacy amount;
- request status and note;
- creator/reviewer metadata;
- RLS enabled;
- no direct `PUBLIC`, `anon`, or `authenticated` table access;
- all foreign keys use `ON DELETE RESTRICT`;
- no cascade or hard-delete behavior.

### `public.submit_legacy_registration(customer_input jsonb, kiosks_input jsonb)`

One `SECURITY DEFINER` RPC now performs:

1. staff authentication and permission validation;
2. customer lookup;
3. customer creation when no unambiguous customer exists;
4. Facebook-ID resolution and duplicate checks;
5. one or more Pending kiosk inserts;
6. one Pending payment per kiosk;
7. one Legacy Request per kiosk;
8. exact `total_kiosks` synchronization;
9. one audit-log insert.

Any validation error or database error aborts and rolls back the complete function
call.

## Security and permissions

- Anonymous execution is revoked.
- Only `authenticated` can invoke the RPC.
- The RPC requires an active `user_roles` record.
- Admin is accepted; non-admin access is derived from the existing
  `role_permissions` entry for `legacy-registration`.
- No reviewer permission is hard-coded.
- The function uses an empty search path and fully-qualified objects.
- No frontend `service_role` key or call was added.

## Business rules implemented

- Existing customers are resolved by exact customer Facebook ID first and normalized
  phone second.
- Multiple customers sharing a phone cause a blocking ambiguity error unless an
  exact Facebook-ID match identifies the customer.
- Conflicting phone and Facebook matches are blocked.
- A new customer is created only when lookup finds no existing match.
- All kiosks in one submission attach to the single resolved/created customer.
- Supports 1–50 kiosks per atomic submission.
- Every kiosk requires a numeric Facebook ID, directly supplied or resolvable from a
  numeric Facebook URL.
- Facebook IDs are blocked when duplicated:
  - inside the submitted kiosk array;
  - in existing kiosks;
  - in pending public registration requests;
  - in pending legacy requests.
- Transaction advisory locks protect the duplicate check against concurrent public
  and legacy submissions using the same Facebook ID.
- Customer lookup identifiers are also transaction-locked to prevent concurrent
  duplicate customer creation through this RPC.
- Kiosks are created as `Pending`, with no active service dates.
- Payments are created as `Pending`, never directly as `Completed`.
- Historical dates remain on the Legacy Request and do not activate service.
- Months are calculated in the database from the supplied historical period.
- The pending payment uses current package price and derives a documented discount
  from the supplied legacy amount, ensuring it satisfies the existing
  `confirm_payment()` formula.
- Zero/negative amounts and amounts above the selected package total are rejected.
- No hard delete is performed or exposed.

## Frontend changes

- Removed all direct Customer/Kiosk/Payment service orchestration and cleanup logic
  from `LegacyRegistrationService.create()`.
- The service now makes one `submit_legacy_registration` RPC call.
- Preserved compatibility aliases for the first kiosk/payment/request result.
- Added dynamic multi-kiosk fields to the Legacy Registration page.
- Each kiosk can have its own Facebook data, business type, amount, historical
  period, and note.
- Updated the UI status message to state that payment and kiosk remain Pending.

## Tests performed

- `node --check src/services/LegacyRegistrationService.js` — passed.
- `node --check src/pages/LegacyRegistrationPage.js` — passed.
- `git diff --check` — passed.
- Static migration assertions passed for:
  - RPC existence;
  - authenticated permission enforcement;
  - configured permission lookup;
  - ordered customer/kiosk/payment/request/audit writes;
  - Pending-only payment creation;
  - advisory duplicate locks;
  - absence of hard-delete SQL;
  - `ON DELETE RESTRICT` on all five foreign keys;
  - package/amount/discount reconciliation;
  - absence of `service_role`.
- Reviewed rollback behavior for:
  - missing/invalid customer input;
  - zero or more than 50 kiosks;
  - ambiguous or conflicting customer matches;
  - unresolved, duplicate, and concurrently submitted Facebook IDs;
  - invalid/inactive business types;
  - invalid dates or periods shorter than one month;
  - invalid or unreconcilable amounts;
  - failure during any insert or audit write.
- Reviewed single- and multi-kiosk frontend payload/result handling.

## BLOCKED items

- The migration was not applied and write-path integration tests were not run
  against a database. This workspace has no Supabase CLI/local project runtime, and
  production writes were intentionally not used for testing.
- Supabase changelog retrieval was attempted but the sandbox could not resolve
  `supabase.com`. The implementation follows the repository's established
  security-definer, empty-search-path, explicit-grant conventions.
- Database advisors could not be run because no Supabase CLI or connected project
  tool is available.

## Remaining risks

- Confirming a Pending payment activates service from `confirmed_at` under the
  existing Payment workflow. The historical requested dates remain preserved on the
  Legacy Request and are not copied to the live kiosk service period.
- The Legacy Request status is not automatically changed when its payment is
  confirmed/rejected/cancelled. That state-transition integration requires a
  product decision and a separate payment-workflow change.
- No Legacy Request review/list UI was requested. The records are securely stored
  but currently consumed only through future permission-checked backend/UI work.
- Advisory locks protect the new public and legacy RPC paths. Any remaining direct
  legacy database writers should be removed or protected with a validated unique
  constraint after existing duplicate cleanup.

## Git diff --stat

Implementation files, excluding this report:

```text
 src/pages/LegacyRegistrationPage.js                         |  91 +++++-
 src/services/LegacyRegistrationService.js                   | 168 ++++-------
 supabase/migrations/20260726120000_create_legacy_registration_rpc.sql | 451 +++
 3 files changed, 593 insertions(+), 117 deletions(-)
```

The migration and this report are untracked, so normal `git diff --stat` does not
include them until they are added to Git. No commit or push was performed.
