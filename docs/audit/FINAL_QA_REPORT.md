# FINAL QA REPORT - Kiosk CRM

- **Audit Date:** July 25, 2026
- **Auditor:** Gemini
- **Conclusion:** The application suffers from **critical architectural flaws** that violate core business rules and architectural principles. The most severe issues relate to performing complex calculations and multi-step database transactions on the client-side, which introduces significant risks of poor performance, data corruption, and incorrect business logic execution. A major refactoring effort is strongly recommended before the application is considered production-ready.

---

## Remaining Bugs

### Priority 0 (P0) - Critical / Blocker

These bugs represent fundamental architectural failures that must be fixed immediately. They are likely to cause data corruption or catastrophic performance degradation.

1.  **Client-Side KPI Calculation in Dashboard**
    *   **Module:** Dashboard
    *   **Files:** `src/services/DashboardService.js`, `src/services/RevenueService.js`
    *   **Description:** All key performance indicators (KPIs) and charts on the dashboard are calculated in the browser. The services fetch raw, unaggregated data from the database and then perform summing, grouping, and counting in JavaScript.
    *   **Impact:** This will cause extreme performance degradation as the data volume grows, eventually making the dashboard unusable. It is a direct violation of `KPI & Reports Rules #2`.
    *   **Recommendation:** Refactor all dashboard queries to use database-side aggregation, preferably through a single RPC call (`get_dashboard_data`) that returns all necessary data in a pre-calculated format.

2.  **Client-Side KPI Calculation in Reports**
    *   **Module:** Reports
    *   **File:** `src/services/ReportService.js`
    *   **Description:** The entire reporting module is built on client-side calculations. The service fetches up to 20,000 rows from the `payments` and `kiosks` tables and then generates all report data (summaries, monthly breakdowns, top customers, etc.) in the browser.
    *   **Impact:** This is a critical performance bottleneck that will make the reporting feature non-functional with a realistic dataset. It violates `KPI & Reports Rules #2` and `#6`.
    *   **Recommendation:** Rewrite the entire `ReportService` to use a dedicated database RPC call for each report tab. The RPC should perform all filtering, joining, and aggregation on the database side and return only the final, display-ready data.

3.  **Client-Side Transaction in Public Registration**
    *   **Module:** Registration
    *   **File:** `src/services/RegistrationService.js` (function: `submit`)
    *   **Description:** The public registration process is a multi-step operation executed from the client: 1. Check for existing user, 2. Create customer, 3. Create kiosk, 4. Create payment, 5. Create request. This sequence is not atomic.
    *   **Impact:** This is a race condition waiting to happen. It can lead to duplicate customers and orphaned records (e.g., a customer is created but kiosk creation fails). It also incorrectly allows a public user to attach a new kiosk to an existing customer, violating `Customer Rules #3`.
    *   **Recommendation:** Replace the entire `submit` function body with a single RPC call (e.g., `submit_public_registration`) that encapsulates the entire transactional logic on the database side, including all checks and creations.

4.  **Client-Side Transaction in Legacy Registration**
    *   **Module:** Legacy Registration
    *   **File:** `src/services/LegacyRegistrationService.js` (function: `create`)
    *   **Description:** This service has the same non-atomic, multi-step transaction logic as the public registration service. It attempts to find a customer, then create one, then create a kiosk, then a payment, all from the client. The code even includes commented-out cleanup logic, indicating awareness of the atomicity problem.
    *   **Impact:** High risk of data corruption, duplicate customers, and orphaned kiosk/payment records.
    *   **Recommendation:** Replace the `create` function body with a single RPC call (e.g., `create_legacy_records`) that executes the entire process atomically within a database transaction.

### Priority 1 (P1) - High

These bugs are serious violations of business rules or architectural principles that can lead to incorrect data or poor performance.

1.  **Client-Side Business Logic for Kiosk Renewals**
    *   **Module:** Payments
    *   **File:** `src/services/PaymentService.js`
    *   **Description:** The logic for calculating the start and end dates of a kiosk renewal is implemented in JavaScript on the client-side (`buildRenewalPreview`, `nextRenewalStartDate`). The current logic incorrectly handles renewals for already-expired kiosks.
    *   **Impact:** Incorrect service periods for customers, a major business-facing error. Violates the principle of keeping critical business logic on the database, as stated in `Kiosk Rules #4`.
    *   **Recommendation:** Move the renewal calculation logic into the `confirm_payment` RPC call. The RPC must handle both cases (active and expired kiosks) correctly within the same transaction that confirms the payment.

2.  **Inefficient "Client-Side Joins" in Search/Filter**
    *   **Modules:** Payments, Customers, Kiosks
    *   **Files:** `src/services/PaymentService.js`, `src/services/CustomerService.js`, `src/services/KioskService.js`
    *   **Description:** Multiple services implement a highly inefficient search pattern where they first run separate queries to get lists of IDs (e.g., `findCustomerIds`, `findKioskIds`), and then use these lists in an `IN` clause in the main query.
    *   **Impact:** This "client-side join" pattern causes multiple round-trips to the database and results in very slow search and filter performance.
    *   **Recommendation:** Refactor these list/search functions to use proper `JOIN`s or database views/functions to perform the filtering in a single, efficient query.

3.  **Complex State Changes from Client**
    *   **Module:** Payments
    *   **File:** `src/services/PaymentService.js` (function: `cancelRegistration`)
    *   **Description:** The function for cancelling a registration attempts to manage a transaction across multiple tables (`payments`, `kiosks`, `customers`) from the client, including manual rollback logic in a `catch` block.
    *   **Impact:** High risk of data inconsistency if one of the later updates fails, leaving the database in a partial state.
    *   **Recommendation:** Move this logic into a dedicated RPC call (e.g., `cancel_registration`) that performs all state changes within a single atomic transaction.

### Priority 2 (P2) - Medium

These are significant issues that should be addressed, but are less critical than P0/P1 bugs.

1.  **Inconsistent and Duplicate Audit Logging**
    *   **Modules:** All
    *   **Files:** `src/services/AuditLogService.js`, `src/services/LogService.js`, `DATABASE.md`
    *   **Description:** The application has two separate logging tables (`logs` and `audit_logs`) with different schemas and different services writing to them. The documentation in `DATABASE.md` is also out of date and only describes the older `logs` table.
    *   **Impact:** Creates confusion for developers and makes it difficult to get a complete audit trail. It's a maintenance and data consistency issue.
    *   **Recommendation:** Decide on a single logging strategy. Consolidate all logging into one table (preferably `audit_logs` as it has a better schema) and a single service. Remove the old `logs` table and `LogService`. Update `DATABASE.md`.

### Priority 3 (P3) - Low

These are minor issues or architectural weaknesses that are not immediately harmful but should be improved.

1.  **Client-Side Derived Status for Kiosks**
    *   **Module:** Kiosks
    *   **File:** `src/services/KioskService.js`
    *   **Description:** The logic to determine if a kiosk is in a "warning" or "expired" state is implemented in the `applyStatusFilter` function based on the current date.
    *   **Impact:** While currently centralized in the service, this business logic is more robust if handled by the database (e.g., in a view or generated column). This ensures all parts of the system (including direct database queries or other services) get a consistent status.
    *   **Recommendation:** Create a database view (e.g., `kiosks_with_status`) that calculates the derived status, and have the `KioskService` query this view instead of the raw table.
