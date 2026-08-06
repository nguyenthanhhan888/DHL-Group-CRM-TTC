# TASK P0-02 REPORT — Reports Database Aggregation and Revenue Consistency

## Root causes

The Reports module loaded raw `payments` and `kiosks` records in 1,000-row batches, up to 20,000 rows per table, and calculated nearly every report value in browser JavaScript.

The audit identified:

1. Revenue totals, monthly groups, business-type groups, payment-method groups, top customers, and average payment were client-side calculations.
2. Kiosk totals and derived status groups were client-side calculations.
3. Kiosk expiration used a hard-coded 30-day window instead of `settings.warning_days`.
4. Kiosks could be treated as Expired from `end_date` even when their stored status was not `Expired`, conflicting with the Dashboard KPI definition.
5. Reconciliation only inspected downloaded payment rows and did not cover the required customer, kiosk, duplicate-ID, cache-mismatch, or pending-request problems.
6. Category/Business Type existed only as a client-side revenue grouping, not a standalone report.
7. Customer reporting was absent.
8. The date predicate was always applied to `confirmed_at`, so operational Pending/Rejected/Cancelled counts were normally omitted because those records often have no confirmation date.
9. Sorting was performed with JavaScript array sorting.
10. There was no database pagination; export operated on whichever oversized raw dataset had been downloaded.
11. Several independent client calculations duplicated revenue rules and could diverge from Dashboard.

As documented in `DATABASE.md` and `TASK_P0_01_REPORT.md`, `payments.total_amount` is the physical database column containing the final amount after discounts. It is the schema implementation of the business term `final_amount`.

## Report tabs reviewed

- Overview
  - Previously aggregated payment counts, revenue, top customers, and priority kiosks in the browser.
- Revenue
  - Previously summed and grouped downloaded payments; average was calculated in `ReportsPage`.
- Kiosk
  - Previously derived statuses, grouped rows, filtered follow-up rows, and sorted them in the browser.
- Customer
  - Missing as a standalone report.
- Reconciliation
  - Previously covered only a small subset of payment problems.
- Category / Business Type
  - Previously only a client-side revenue grouping; no paginated report existed.

All six report tabs are now represented in the UI and RPC.

## Files modified

- `src/services/ReportService.js`
  - Replaced raw table queries and all aggregation helpers with one `get_reports_data` RPC call.
  - Added validated filters, allowed page sizes, sorting parameters, and response normalization.
  - Empty/null/invalid numeric response values normalize safely to `0`.
- `src/pages/ReportsPage.js`
  - Preserved the existing visual style while adding Customer and Category/Business Type tabs.
  - Added customer, kiosk, payment-status, kiosk-status, category, business-type, sorting, sort-direction, and page-size controls.
  - Added database-backed pagination controls.
  - Removed frontend report calculations and sorting.
  - Export now uses only the exact rows returned for the displayed database page.
- `supabase/migrations/20260725160000_create_reports_data_rpc.sql`
  - Added the secured, read-only Reports RPC.
- `TASK_P0_02_REPORT.md`
  - Added this report.

No registration, customer CRUD, kiosk CRUD, staff, settings, or payment-confirmation workflow file was modified.

## RPC/view/migration created

Migration:

`supabase/migrations/20260725160000_create_reports_data_rpc.sql`

RPC:

`public.get_reports_data(...) returns jsonb`

The RPC accepts:

- report type
- inclusive start/end dates
- customer ID
- kiosk ID
- category ID
- business type ID
- payment status
- kiosk status, including Expiring Soon
- sort field and direction
- page number
- page size: 25, 50, or 100; default 50

The RPC:

- is read-only and does not repair or mutate data
- calculates summaries, groups, sorting, and pagination in PostgreSQL
- returns at most 100 detail rows
- uses `Asia/Ho_Chi_Minh` business-period boundaries
- uses `SECURITY DEFINER` with an empty `search_path` and fully qualified relations
- verifies an authenticated, active staff record
- permits Admin or a role whose configured permissions contain `reports`
- does not hard-code Reviewer access by role name
- revokes execution from `PUBLIC` and `anon`
- grants execution only to `authenticated`
- uses no frontend `service_role`

The migration was created manually because the Supabase CLI is not installed in this workspace.

## Formulas implemented

### Financial revenue

```text
SUM(payments.total_amount)
WHERE lower(payment_status) = 'completed'
  AND confirmed_at IS NOT NULL
  AND confirmed_at >= selected period start
  AND confirmed_at < day after selected period end
```

This is the same eligibility, amount field, timezone, and half-open timestamp-boundary approach as the P0-01 Dashboard RPC.

`start_date`, `end_date`, and `created_at` are never used as financial revenue dates.

For non-financial operational counts only, Pending/Rejected/Cancelled records use `created_at` for the selected operational period because they do not have a revenue-recognition date. Their amounts never enter revenue.

### Revenue report

- Total revenue: eligible-payment sum.
- Completed count: eligible-payment count.
- Average payment: database `AVG(total_amount)`.
- Highest payment: database `MAX(total_amount)`.
- Lowest payment: database `MIN(total_amount)`.
- Chart-ready monthly data: grouped by `confirmed_at` in the business timezone.
- Business Type and payment-method groups: database `GROUP BY`.
- Detail rows: same filtered eligible-payment CTE, server sorted and paginated.
- Empty aggregates: `COALESCE(..., 0)`.

### Kiosk report

- Total: all filtered Kiosk records.
- Active, Pending, Expired, Suspended: exact stored status counts.
- Expiring Soon: Active Kiosks with `end_date` between the current business date and `settings.warning_days`, inclusive.
- Detail rows: server filtered, sorted, and paginated.

### Customer report

For each filtered customer:

- total Kiosks
- Active Kiosks
- Expired Kiosks
- total paid from eligible completed payments in the selected period
- latest eligible completed payment by `confirmed_at`
- latest Kiosk `end_date`

### Reconciliation report

The database detects and reports without mutation:

1. Completed payment without `confirmed_at`
2. Payment without customer
3. Payment without Kiosk
4. Kiosk without customer
5. Kiosk without Facebook ID
6. Duplicate Kiosk Facebook ID
7. Kiosk without `end_date`
8. `customers.total_kiosks` mismatch
9. `customers.total_paid` mismatch
10. Invalid Completed payment amount
11. Duplicated Pending registration request by Facebook ID

The requested list contains ten bullets, with payment-link absence represented as two distinct required checks; the RPC therefore exposes eleven issue codes.

### Category / Business Type report

Database aggregation returns:

- Category and Business Type
- configured monthly price
- Kiosk count
- Active/Pending/Expired Kiosk counts
- eligible Completed payment count
- eligible financial revenue

## Old client-side logic removed

Removed from Reports:

- 1,000-row batching
- 20,000-row cap and raw-record loops
- client payment filtering
- client revenue summing
- client monthly grouping
- client Business Type grouping
- client payment-method grouping
- client top-customer grouping
- client average calculation
- client Kiosk derived-status calculation
- hard-coded 30-day expiration window
- client Kiosk status grouping
- client reconciliation generation
- client report sorting
- unpaginated detail rendering

The remaining `.filter()` in `ReportsPage` only limits already-loaded Business Type filter options to the selected Category; it does not filter report data.

## Tests performed

Passed:

- `node --check src/services/ReportService.js`
- `node --check src/pages/ReportsPage.js`
- `git diff --check`
- Mocked RPC request/normalization test:
  - invalid page → page 1
  - disallowed page size → 50
  - invalid date → SQL `null`
  - numeric filter string → integer RPC parameter
  - null revenue → `0`
  - numeric count string → finite number
  - missing rows/groups/pagination totals → empty arrays/`0`
- Mocked Supabase error test confirmed RPC errors propagate through `runQuery` to the page error state.
- Static removal check confirmed no `MAX_REPORT_ROWS`, `20000`, `fetchReportRows`, or legacy aggregation helpers remain.
- Static SQL contract checks confirmed:
  - Completed predicate exists in every financial branch
  - non-null `confirmed_at` is required for revenue
  - selected-period upper boundaries are exclusive
  - page size is restricted to 25/50/100
  - anonymous execution is revoked
  - permission configuration is consulted
  - all eleven reconciliation issue codes exist
- Manual formula comparison against P0-01 confirmed Dashboard and Reports use:
  - `payments.total_amount`
  - Completed status only
  - non-null `confirmed_at`
  - `Asia/Ho_Chi_Minh`
  - inclusive lower/exclusive upper period boundaries
- Source inspection confirmed there is no raw 20,000-row Reports fetch.
- Empty-state paths use SQL `COALESCE`, `[]` JSON defaults, and frontend finite-number normalization.
- Pagination and requested sorting are applied before the RPC aggregates detail rows into JSON.
- Pending/Rejected/Cancelled are excluded from every financial-revenue CTE.

## BLOCKED items

### Database execution tests

BLOCKED: neither Supabase CLI, `psql`, nor a local PostgreSQL runtime is installed. The migration was not applied to a remote project because external schema deployment was not requested. Therefore fixture-backed tests for:

- exact Dashboard/Reports equality against real rows
- midnight month/year boundaries
- each reconciliation fixture
- SQL execution plans
- Supabase database advisors

must be run in local or staging Supabase before deployment.

### Large export

BLOCKED: a safe asynchronous/streaming large-export pipeline cannot be implemented solely with the existing static frontend and a bounded synchronous report RPC without introducing an Edge Function, background job, or storage workflow outside this task.

The UI now explicitly exports only the displayed filtered page, capped at 100 rows. It does not issue a second query or reproduce report filters/calculations in JavaScript, and therefore cannot freeze the browser with a 20,000-row CSV.

## Remaining risks

1. The SQL migration has received static review but could not be executed locally due to the blocked database runtime.
2. The repository documents `total_amount` as the final paid amount. If an environment has an undocumented physical `final_amount` column, the migration must be adjusted before application.
3. Runtime compatibility depends on production matching documented columns, including registration-request links/timestamps and customer cache fields.
4. The Reports RPC intentionally duplicates the already-migrated Dashboard revenue predicate because P0-02 scope does not permit modifying Dashboard files or the P0-01 migration. The formulas are identical, but a future database refactor could place the eligible-payment relation in one shared private SQL function/view.
5. Category and filter-option selectors still use their existing small list services; report rows and calculations themselves are entirely RPC-backed.
6. Reconciliation is detection-only by design and does not repair any mismatch.

## Git diff --stat

P0-02 tracked-file diff at report creation:

```text
 src/pages/ReportsPage.js      | 640 +++++++++++++++++++++++-------------------
 src/services/ReportService.js | 476 ++++++-------------------------
 2 files changed, 432 insertions(+), 684 deletions(-)
```

Untracked P0-02 files are not included by `git diff --stat` until staged:

```text
 supabase/migrations/20260725160000_create_reports_data_rpc.sql | 1056 lines
 TASK_P0_02_REPORT.md                                           | new file
```

Existing P0-01 working-tree changes were preserved and not modified by this task.

No commit or push was performed.
