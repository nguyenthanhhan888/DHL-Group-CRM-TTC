# TASK 01: Revenue Inconsistency Fix Report

- **Date:** July 25, 2026
- **Author:** Gemini
- **Purpose:** This report documents the work done to fix revenue calculation inconsistencies across the CRM, as part of TASK 01.

---

## 1. Files Modified

The following files were modified to correct and centralize the revenue calculation logic:

-   **`src/services/RevenueService.js`**: (New file) Created to serve as a single source of truth for building revenue-related database queries. It enforces the business rules that revenue is based on `payment_status = 'completed'` and uses `confirmed_at` for all date-based calculations.
-   **`src/services/DashboardService.js`**: Refactored to use the new `RevenueService`. The `getPaymentRevenueInRange` and `buildMonthlyRevenueSeries` functions were updated to use `confirmed_at`, fixing incorrect dashboard statistics and charts.
-   **`src/services/PaymentService.js`**: The `buildPaymentSummary` function was corrected to use `confirmed_at` (instead of `start_date`) when calculating "This Month's Revenue". The underlying query was also updated to fetch `confirmed_at`.
-   **`src/services/ReportService.js`**: Significantly refactored to align with business rules.
    -   The main payment query now filters by `confirmed_at`.
    -   The monthly revenue report (`buildRevenueByMonth`) now groups data by `confirmed_at`.
    -   Added a `TODO` comment highlighting the critical performance issue of fetching all data to the client, recommending a future migration to a backend RPC.

---

## 2. Revenue Bugs Fixed

This refactoring addressed a systemic issue where revenue calculations were incorrectly based on `start_date` instead of the official revenue recognition date, `confirmed_at`.

-   **Dashboard:**
    -   **FIXED:** "Doanh thu tháng này" (Revenue This Month) stat was incorrect.
    -   **FIXED:** "Doanh thu năm" (Revenue This Year) stat was incorrect.
    -   **FIXED:** The "Doanh thu theo tháng" (Monthly Revenue) chart was displaying incorrect data.

-   **Payments Page:**
    -   **FIXED:** The "Tháng này" (This Month) revenue summary stat was incorrect.

-   **Reports Page:**
    -   **FIXED:** All date-filtered revenue reports were incorrect because the data query used `start_date`.
    -   **FIXED:** The "Doanh thu theo tháng" report table was grouped incorrectly by `start_date`.

---

## 3. Remaining Issues

-   **[P1 High] Performance in Reports:** The `ReportService.js` still fetches up to 20,000 payment records into the frontend to generate reports. While the calculation logic is now correct for the data it receives, this is not scalable and will lead to slow load times and high memory usage as the data grows. This is a critical performance bottleneck.

---

## 4. Future Improvements

-   **Implement RPC for Reports:** The most critical next step is to replace the client-side report generation in `ReportService.js` with a set of Supabase RPC (Remote Procedure Call) functions. The database should perform all aggregations (e.g., SUM, GROUP BY) and return only the summarized data needed for the reports. This will resolve the performance bottleneck.
-   **Consolidate All Revenue Logic:** While `RevenueService.js` was created, `ReportService.js` and `PaymentService.js` were fixed in-place due to their unique structures. A future task could involve a deeper refactor to make them consume `RevenueService.js` directly, further reducing code duplication.
