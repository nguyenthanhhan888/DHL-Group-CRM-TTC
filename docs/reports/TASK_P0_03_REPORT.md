# TASK P0-03 REPORT — Payment Workflow and Renewal Engine

## Files modified

- `src/services/PaymentService.js`
  - Replaced confirmation, cancellation, rejection, Pending edits, renewal creation, adjustment creation, completed-note edits, and summary revenue calculations with database RPC calls.
  - Removed client-side renewal date and amount calculations.
  - Removed the multi-table cancellation sequence and manual rollback.
  - Removed client-side payment revenue aggregation.
  - Prevents new client-created payments from starting directly as Completed.
- `src/pages/PaymentsPage.js`
  - Uses the new atomic workflow methods.
  - Requires reasons for cancellation and rejection.
  - Adds an adjustment action for standard Completed payments.
  - Updates cancellation wording so it no longer claims to mutate registration/customer/Kiosk records.
- `src/pages/PaymentDetailPage.js`
  - Displays transaction type, adjusted payment ID, and adjustment reason.
- `src/components/PaymentEditForm.js`
  - Completed payments expose note-only editing.
  - Pending payments edit months, discount, discount reason, method, and note.
  - Removes editable service dates and direct total-amount entry; the database recalculates them.
- `src/components/RenewKioskForm.js`
  - Removes frontend renewal-date, subtotal, and total calculations.
  - Clearly states that package pricing is calculated when creating the Pending payment and service dates are calculated at confirmation.
- `supabase/migrations/20260726100000_create_payment_workflow.sql`
  - Adds the complete database workflow, adjustment metadata, triggers, authorization, auditing, and totals synchronization.
- `TASK_P0_03_REPORT.md`
  - Adds this implementation report.

No Dashboard, Reports, Registration, Legacy Registration, Customer CRUD, Kiosk CRUD, Staff, Settings, or TTC source file was modified.

## RPCs created

### `confirm_payment(payment_id_input, reason_input)`

Atomically:

1. Verifies the authenticated staff member is active and has the configured `payments` permission, or is Admin.
2. Locks the payment row with `FOR UPDATE`.
3. Requires status Pending and a standard transaction.
4. Locks and validates the customer.
5. Locks and validates the Kiosk and its ownership.
6. Validates the active Business Type/package.
7. Validates months, price, discount, positive total amount, and amount arithmetic.
8. Calculates the renewal period at confirmation time.
9. Changes the payment to Completed and sets `confirmed_at`/`confirmed_by`.
10. Updates the Kiosk service period and status.
11. Recalculates customer and Kiosk paid totals through the totals trigger.
12. Recalculates `customers.total_kiosks`.
13. Writes an `audit_logs` record.
14. Returns the resulting payment, Kiosk, and customer.

Revenue is not stored in a separate mutable total. The authoritative revenue event is the new immutable payment state:

```text
payment_status = Completed
AND confirmed_at IS NOT NULL
```

Dashboard, Reports, and Payment summary therefore recognize the same record.

### `create_renewal_payment(...)`

- Validates Kiosk, customer, active package, months, discount, and package price.
- Calculates price and final `total_amount` in PostgreSQL.
- Creates only a Pending payment.
- Leaves `start_date` and `end_date` null until confirmation.
- Writes an audit record and returns the payment/package.

### `update_pending_payment(...)`

- Locks the row and requires Pending.
- Revalidates Kiosk/customer/package.
- Recalculates package price and final amount.
- Clears premature service dates.
- Writes an audit record.

### `update_payment_note(...)`

- Allows the non-financial note field to be changed without weakening Completed-payment immutability.
- Writes an audit record.

### `cancel_payment(payment_id_input, reason_input)`

- Requires a non-empty reason.
- Locks the payment.
- Allows only Pending → Cancelled.
- Does not mutate customer or Kiosk records.
- Writes an audit record.

### `reject_payment(payment_id_input, reason_input)`

- Requires a non-empty reason.
- Locks the payment.
- Allows only Pending → Rejected.
- Writes an audit record.

### `create_payment_adjustment(...)`

- Never overwrites the original Completed payment.
- Requires a valid Completed original, non-zero amount delta, and reason.
- Creates a separate linked Completed adjustment transaction.
- Supports positive or negative revenue deltas.
- Supports an optional signed service-month delta.
- Restricts service-period correction to the latest standard payment for that Kiosk.
- Prevents more than one adjustment for the same original payment.
- Recalculates Kiosk service dates and paid totals atomically.
- Recalculates customer paid totals atomically.
- Writes an audit record and returns the original, adjustment, Kiosk, and customer.

### `get_payment_summary(...)`

- Calculates Payment-page totals in PostgreSQL.
- Revenue requires Completed plus non-null `confirmed_at`.
- Monthly revenue uses `confirmed_at` and `Asia/Ho_Chi_Minh` half-open month boundaries.
- Pending, Rejected, and Cancelled never enter revenue.
- Empty results return zero.

## Triggers created

### `protect_payment_records_trigger`

`BEFORE INSERT OR UPDATE OR DELETE ON payments`

Enforces:

- no hard deletion of any payment
- every ordinary new payment starts Pending
- only `confirm_payment()` can transition Pending → Completed
- only `reject_payment()` can transition Pending → Rejected
- only `cancel_payment()` can transition Pending → Cancelled
- Pending financial edits must use `update_pending_payment()`
- Completed financial fields, dates, relationships, status, confirmation data, and adjustment metadata are immutable
- Rejected and Cancelled are terminal
- Completed corrections must use a new adjustment transaction

### `sync_customer_payment_totals_trigger`

`AFTER INSERT OR UPDATE ON payments`

Recalculates from source rows:

```text
customers.total_paid =
SUM(total_amount)
WHERE payment_status = Completed
  AND confirmed_at IS NOT NULL
  AND customer_id matches
```

It also recalculates the corresponding `kiosks.total_paid` with the same eligibility rule. Adjustment inserts and confirmation updates automatically invoke this single totals path.

## Workflow changes

### Pending

- May be edited only through the validated Pending RPC for financial fields.
- Package price and final amount are recalculated by the database.
- Service dates remain unset until confirmation.
- May transition only to Completed, Rejected, or Cancelled through the corresponding RPC.

### Completed

- Created only through confirmation or the adjustment RPC.
- Has a non-null confirmation timestamp.
- Financial fields and relationships are locked by a table trigger.
- Only note editing remains available.
- Duplicate confirmation fails because the row is locked and no longer Pending.

### Rejected / Cancelled

- Only Pending payments can enter these states.
- A reason is mandatory.
- Both states are terminal and have no financial/service effect.

### Renewal

- Frontend no longer calculates authoritative dates.
- Expired, Pending, missing-date, or otherwise non-active Kiosk:
  - `start_date = confirmed_at` business date.
- Active Kiosk whose `end_date` has not passed:
  - `start_date = current end_date + 1 day`.
- `end_date = start_date + payment months`.
- Multiple pending renewals are serialized with row locks; each confirmation recalculates from the latest Kiosk period.

### Adjustment

- Original payment remains unchanged.
- Adjustment references the original with `adjusts_payment_id`.
- `transaction_type = adjustment`.
- Revenue delta is recognized at the adjustment's own `confirmed_at`.
- Full service reversal restores the preceding standard payment period when one exists; otherwise the Kiosk becomes Expired with no active period.

## Business rules implemented

- Status set: Pending, Completed, Rejected, Cancelled.
- Revenue requires Completed and non-null `confirmed_at`.
- Revenue date is always `confirmed_at`.
- Pending/Rejected/Cancelled do not affect revenue or totals.
- Completed financial data is immutable.
- Wrong Completed payments are corrected with linked adjustment transactions.
- Renewal calculation occurs only in the backend.
- Confirmation is atomic and row-locked.
- Customer and Kiosk paid totals are automatically reconstructed from eligible payment rows.
- Customer/Kiosk/package linkage is validated.
- Audit records are written inside the same transaction as workflow state changes.
- No frontend service-role credential was introduced.
- RPC authorization follows existing configured `payments` permissions rather than hard-coding Reviewer access.

## Tests performed

Passed:

- JavaScript syntax:
  - `src/services/PaymentService.js`
  - `src/pages/PaymentsPage.js`
  - `src/pages/PaymentDetailPage.js`
  - `src/components/PaymentEditForm.js`
  - `src/components/RenewKioskForm.js`
- `git diff --check`.
- Mocked RPC-routing test verified:
  - confirmation → `confirm_payment`
  - cancellation → `cancel_payment`
  - rejection → `reject_payment`
  - adjustment → `create_payment_adjustment`
  - renewal → `create_renewal_payment`
  - Pending edit → `update_pending_payment`
  - note edit → `update_payment_note`
  - normalized IDs/numbers/reasons are passed to the database
- Mocked Supabase failure test confirmed RPC errors propagate cleanly to the caller/UI.
- Static source audit confirmed removal of:
  - `calculateRenewalPreview`
  - `buildRenewalPreview`
  - `nextRenewalStartDate`
  - client `addMonths` renewal calculation
  - multi-table cancellation rollback
  - direct payment-status updates
  - client payment-summary aggregation
- Static SQL contract review verified:
  - all mutation RPCs exist
  - payment/customer/Kiosk rows are locked
  - Pending-only transitions
  - Active renewal starts at current `end_date + 1`
  - expired/non-active renewal starts at confirmation date
  - confirmation sets Completed plus `confirmed_at`
  - duplicate confirmation fails the Pending check
  - adjustments are separate linked rows
  - audit logging is transactional
  - totals triggers exist
  - anonymous execution is revoked
  - authenticated execution is explicitly granted

Requested scenario coverage:

- Pending: validated edit and allowed transitions.
- Completed: atomic confirmation and immutable financial fields.
- Rejected: Pending-only RPC with mandatory reason.
- Cancelled: Pending-only RPC with mandatory reason.
- Adjustment: linked transaction; original remains unchanged.
- Expired renewal: starts on confirmation business date.
- Active renewal: starts one day after current Kiosk end date.
- Duplicate confirmation: rejected after row lock because status is no longer Pending.
- Supabase failure: error propagates; PostgreSQL function exceptions roll back the complete transaction.

### Database-runtime limitation

Neither Supabase CLI nor `psql` is installed in the workspace. The migration was not applied to a remote project. Therefore fixture-backed database execution, concurrent-confirmation tests, SQL advisor output, and actual trigger tests remain to be run in local/staging Supabase before deployment.

## Remaining risks

1. The migration has received static review but not execution against the real schema because no local database runtime is available.
2. `payments.total_amount` is used as the documented physical final-amount column. An environment with an undocumented `final_amount` column needs migration adjustment.
3. The excluded Legacy Registration flow currently attempts to create Completed payments directly. The new trigger intentionally blocks that violation. P0-03 did not modify Legacy Registration, so that flow requires its own follow-up migration to use confirmation.
4. The existing older `private.complete_payment` function remains in migration history, but the new trigger blocks it from changing a payment to Completed because it does not establish the authorized workflow context. It should be retired in a later database-cleanup task after dependency review.
5. P0-02 reconciliation currently treats non-positive Completed amounts as invalid. Negative adjustment transactions are legitimate, so the Reconciliation RPC needs a future scoped update to distinguish standard payments from adjustments.
6. Service-period correction is deliberately restricted to the newest standard payment. Correcting an older service payment after later renewals requires a more advanced chronological replay engine.
7. Existing production totals are not bulk-rewritten by this safe migration. A customer's/Kiosk's totals are recalculated when an affected payment is subsequently inserted or updated; a separate audited reconciliation/rebuild tool is still needed for historical cache repair.
8. Payment list search still uses its pre-existing multi-query ID lookup. This does not affect confirmation atomicity or revenue correctness but remains a performance follow-up.

## Git diff --stat

P0-03 tracked-file diff at report creation:

```text
 src/components/PaymentEditForm.js |  41 ++--
 src/components/RenewKioskForm.js  |  58 +-----
 src/pages/PaymentDetailPage.js    |   3 +
 src/pages/PaymentsPage.js         |  93 ++++++++-
 src/services/PaymentService.js    | 422 +++++++++++++-------------------------
 5 files changed, 241 insertions(+), 376 deletions(-)
```

Untracked P0-03 files are not included by `git diff --stat` until staged:

```text
 supabase/migrations/20260726100000_create_payment_workflow.sql | 1148 lines
 TASK_P0_03_REPORT.md                                           | new file
```

Existing P0-01 and P0-02 working-tree changes were preserved.

No commit or push was performed.
