# TASK P0-01 REPORT — Revenue Source of Truth and Dashboard KPI

## Root cause

The Dashboard had no database-side source of truth. `DashboardService` issued multiple direct table queries, downloaded payment and kiosk rows, then delegated revenue summing/month grouping and category grouping to browser JavaScript.

Incorrect formulas and behaviors found:

1. Active Kiosks included `active` and the non-business status `warning`, then further inferred activity from `end_date`.
2. Expired Kiosks included records based on `end_date < today`, even when `status` was not `Expired`.
3. Pending Kiosks was not calculated or displayed.
4. Expiring Soon used a hard-coded 30-day window instead of `settings.warning_days`.
5. Expiring Soon included `warning` status instead of requiring `status = Active`.
6. Monthly and yearly payment rows were fetched to the browser and summed there.
7. The annual monthly-revenue series was grouped in browser JavaScript.
8. Category distribution was grouped in browser JavaScript.
9. Multiple independent queries could observe different database snapshots and return internally inconsistent Dashboard values.

`DATABASE.md` identifies `payments.total_amount` as the physical column containing the final amount paid after discounts. The RPC therefore uses `SUM(total_amount)` as the schema-equivalent implementation of the business term `SUM(final_amount)`.

## Files modified

- `src/services/DashboardService.js`
  - Replaced all direct Dashboard table queries with one `get_dashboard_data` RPC call.
  - Removed client-side KPI, revenue, category, and list query helpers.
  - Added defensive normalization so missing/invalid numeric values become `0`.
- `src/services/RevenueService.js`
  - Removed raw payment query construction, date filtering, summing, and monthly grouping.
  - Retained display-boundary normalization only; authoritative revenue logic is now in the RPC.
- `src/pages/DashboardPage.js`
  - Preserved the existing layout and added the required Pending Kiosks and Expiring Soon KPI cards.
- `supabase/migrations/20260725150000_create_dashboard_data_rpc.sql`
  - Added the database-side Dashboard source of truth.
- `TASK_P0_01_REPORT.md`
  - Added this implementation and verification report.

No Reports or Payment workflow files were modified.

## Migration/RPC created

Migration: `supabase/migrations/20260725150000_create_dashboard_data_rpc.sql`

RPC: `public.get_dashboard_data(p_year integer, p_month integer) returns jsonb`

Safety and access properties:

- Read-only function; it performs no `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, or production-data correction.
- Uses `SECURITY DEFINER` with an empty `search_path` and fully qualified relations.
- Requires an authenticated, active `user_roles` record.
- Allows Admin or a role whose configured permissions include `dashboard`.
- Revokes execution from `PUBLIC` and `anon`; grants execution only to `authenticated`.
- Uses a single database statement to return summary KPIs, monthly revenue, category distribution, expiring kiosks, and recent customers.
- Uses `Asia/Ho_Chi_Minh` for business-day, month, and year boundaries, consistent with the existing payment-confirmation migration.
- Uses bounded lists (24 expiring kiosks and 5 recent customers); no raw bulk dataset is returned.

The migration was created manually because the Supabase CLI is not installed in the workspace.

## Formulas implemented

Revenue eligibility:

```sql
lower(payment_status) = 'completed'
and confirmed_at is not null
```

Monthly revenue:

```text
SUM(payments.total_amount)
where eligible
and confirmed_at >= selected month start
and confirmed_at < next month start
```

Yearly revenue:

```text
SUM(payments.total_amount)
where eligible
and confirmed_at >= selected year start
and confirmed_at < next year start
```

The monthly chart applies the same eligibility and half-open `confirmed_at` boundaries independently to all 12 months of the selected year. Revenue never uses `start_date`, `end_date`, or `created_at`.

Dashboard KPIs:

- Total Customers: `COUNT(*)` from `customers`.
- Total Kiosks: `COUNT(*)` from `kiosks`.
- Active Kiosks: count where `lower(status) = 'active'`.
- Pending Kiosks: count where `lower(status) = 'pending'`.
- Expired Kiosks: count where `lower(status) = 'expired'`.
- Expiring Soon: count where status is Active and `end_date` is between the current business date and current business date plus `settings.warning_days`, inclusive.
- All empty aggregate values use `COALESCE(..., 0)`.

## Tests performed

Passed:

- `node --check` for:
  - `src/services/DashboardService.js`
  - `src/services/RevenueService.js`
  - `src/pages/DashboardPage.js`
- `git diff --check`.
- Frontend normalization test with a mocked single RPC response:
  - null customer count → `0`
  - undefined kiosk count → `0`
  - invalid Expiring Soon value → `0`
  - null monthly revenue → `0`
  - numeric strings → finite numbers
  - absent monthly data → exactly 12 zero-valued months
- Static source check confirmed Dashboard/Revenue services contain:
  - no direct `payments`, `customers`, or `kiosks` reads
  - no client-side revenue sum/group functions
  - no revenue reference to `start_date`, `end_date`, or `created_at`
- SQL contract review covered the requested cases:
  - no payments → both revenue aggregates `0`
  - Pending → excluded by Completed predicate
  - Rejected → excluded by Completed predicate
  - Cancelled → excluded by Completed predicate
  - Completed with `confirmed_at` → included
  - Completed without `confirmed_at` → excluded
  - month/year boundaries → inclusive lower bound and exclusive next-period bound
  - empty kiosk/customer tables → count aggregates `0`, distributions/lists `[]`
  - no NaN/null/undefined reaches KPI rendering due SQL `COALESCE` plus frontend finite-number normalization

## Blocked items

- Database execution tests were not run because neither Supabase CLI nor a local PostgreSQL client/runtime is installed.
- The migration was not applied to any remote Supabase project because this task requested a safe migration and prohibited production-data changes; applying schema to an external environment was not necessary or authorized.
- Consequently, fixture-backed RPC execution and database advisor output remain to be run in a local/staging Supabase environment after migration application.

## Remaining risks

1. The physical amount column is `total_amount`, while the business rule uses the term `final_amount`. This implementation follows the documented current schema meaning; if a real `final_amount` column exists in an environment but is absent from `DATABASE.md` and repository code, the migration must be adjusted before application.
2. Runtime correctness depends on production matching the documented columns and relationships (`user_roles.is_active`, `role_permissions.permissions`, kiosk/category/customer foreign keys).
3. Database syntax and permission behavior have been statically reviewed but require the blocked local/staging migration test before deployment.
4. Reports remain on their existing implementation by explicit task scope and may not yet match this Dashboard source until a separate Reports task updates them.

## Git diff --stat

Tracked diff at report creation:

```text
 src/pages/DashboardPage.js       |   6 ++
 src/services/DashboardService.js | 154 ++++++++++-----------------------------
 src/services/RevenueService.js   |  95 +++++-------------------
 3 files changed, 60 insertions(+), 195 deletions(-)
```

Untracked task files are not included by `git diff --stat` until staged:

```text
 supabase/migrations/20260725150000_create_dashboard_data_rpc.sql | 217 lines
 TASK_P0_01_REPORT.md                                             | new file
```

No commit or push was performed.
