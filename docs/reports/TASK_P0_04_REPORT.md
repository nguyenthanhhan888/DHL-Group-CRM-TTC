# TASK P0-04 — Public Registration

## Root cause

The public registration service performed customer lookup/creation, kiosk creation,
payment creation, registration-request creation, and audit logging as separate
browser-side calls. A failure after any successful call left partial production
records. The browser also reused a customer by phone, although phone is not a unique
customer identifier, and duplicate Facebook checks were not protected against
concurrent submissions.

## Files modified

- `src/services/RegistrationService.js`
- `src/pages/RegisterPage.js`
- `supabase/migrations/20260726110000_create_public_registration_rpc.sql` (new)
- `TASK_P0_04_REPORT.md` (new)

No Dashboard, Reports, Payment workflow, Staff, Settings, or existing production
data was modified.

## RPC and database objects created

- `public.submit_public_registration(customer_input jsonb, kiosks_input jsonb, bill_input jsonb)`
  - `SECURITY DEFINER`
  - empty `search_path`
  - explicit fully-qualified database objects
  - executable only by `anon` and `authenticated`
- `public.registration_request_bills`
  - private, RLS-enabled bill storage
  - no direct privileges for `PUBLIC`, `anon`, or `authenticated`
  - `RESTRICT` foreign key to the registration request
  - maximum bill size enforced at 5 MB

The RPC performs validation, Facebook-ID resolution, duplicate checking, one
customer insert, one or more kiosk/payment/request inserts, optional bill storage,
customer kiosk-total synchronization, and audit insertion in one PostgreSQL
transaction. Any exception rolls back every database write.

## Business rules implemented

- Creates exactly one new customer per public submission and attaches all submitted
  kiosks to it.
- Does not look up, reuse, or merge a customer by phone.
- A normalized matching phone produces a `DUPLICATE_PHONE` warning but does not
  block registration.
- Public users cannot attach kiosks to an existing customer.
- Every kiosk requires a numeric Facebook ID, supplied directly or resolved from a
  numeric Facebook URL.
- Duplicate Facebook IDs are blocked across:
  - the same multi-kiosk submission;
  - existing kiosks;
  - existing customers;
  - pending registration requests.
- Transaction-scoped advisory locks serialize concurrent submissions for the same
  Facebook ID.
- Supports 1–20 kiosks per submission.
- Active business type, month range, price, discount, and discount reason are
  validated and calculated authoritatively in the database.
- Creates payments only as `Pending`; pending payments have no confirmed service
  dates and no revenue effect.
- Creates one pending registration request per kiosk.
- Stores one optional JPG, PNG, WEBP, or PDF bill for the submission, limited to
  5 MB, inside the same transaction.
- Writes one audit record containing created customer/kiosk/request IDs, warnings,
  and bill presence without copying bill bytes into the audit log.
- No frontend `service_role` key or call was added.

## Frontend workflow changes

- Replaced the public flow's separate Customer/Kiosk/Payment/Request calls with one
  `submit_public_registration` RPC call.
- Preserved the existing single-kiosk form behavior.
- Added dynamic multi-kiosk input and aggregate payment preview.
- Added optional bill selection and safe Base64 transport to the RPC.
- Preserved the existing result aliases for the first kiosk while also returning
  the complete `kiosks` result array.
- Displays duplicate-phone warnings returned by the transaction.
- The separate admin flow for adding a kiosk to an existing customer was left
  unchanged.

## Tests performed

- `node --check src/services/RegistrationService.js` — passed.
- `node --check src/pages/RegisterPage.js` — passed.
- `git diff --check` — passed.
- Static migration assertions passed for:
  - RPC existence;
  - transactional database workflow;
  - secure `SECURITY DEFINER` configuration;
  - concurrent duplicate-Facebook protection;
  - pending-only payment creation;
  - audit insertion;
  - 5 MB bill limit;
  - absence of `service_role`.
- Reviewed rollback paths for invalid customer data, zero kiosks, more than 20
  kiosks, unresolved/duplicate Facebook IDs, inactive/invalid business types,
  invalid months/discounts, invalid bill type/Base64/size, and failures during any
  insert. PostgreSQL exceptions abort the complete RPC transaction.
- Reviewed single- and multi-kiosk response mapping, aggregate preview, empty bill,
  and duplicate-phone warning handling.

## BLOCKED items

- The migration was not applied and the write-path integration tests were not run
  against a database. No local Supabase CLI/project runtime is available in this
  workspace, and testing against production would create data, which this task
  explicitly forbids.
- Admin viewing/downloading of the private bill is not added here. The bill is
  stored safely and atomically, but exposing it requires an authenticated,
  permission-checked admin RPC/UI decision outside this public-registration scope.

## Remaining risks

- PostgreSQL `bytea` bill storage provides the required rollback guarantee but can
  increase database size. A later move to object storage would need an outbox or
  compensating-cleanup design because Storage uploads are not part of the database
  transaction.
- Vanity Facebook URLs that do not contain a numeric ID still depend on the
  existing `resolve-facebook-id` Edge Function before submission. The database
  resolves numeric profile URLs and `?id=` URLs only.
- Advisory locking protects callers of this RPC. Other legacy write paths that
  create kiosks directly should eventually be moved behind database functions or a
  validated unique constraint after duplicate-data cleanup.
- Public abuse/rate limiting must be enforced at the API/Edge/WAF layer; PostgreSQL
  validation limits each submission but is not a rate limiter.

## Git diff --stat

Implementation files (excluding this report):

```text
 src/pages/RegisterPage.js                            | 132 ++++++++++++++++--
 src/services/RegistrationService.js                  | 159 +++++++++-----------
 supabase/migrations/20260726110000_create_public_registration_rpc.sql | 405 +++
 3 files changed, 594 insertions(+), 102 deletions(-)
```

The migration and this report are untracked, so normal `git diff --stat` does not
include them until they are added to Git. No commit or push was performed.
