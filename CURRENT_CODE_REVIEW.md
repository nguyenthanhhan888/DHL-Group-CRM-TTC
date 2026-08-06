# CURRENT CODE REVIEW
- **Date:** July 25, 2026
- **Author:** Gemini
- **Purpose:** A source-state review of changed and untracked files in the working directory. This report outlines findings, conflicts with business rules, and recommended actions before starting TASK 01.

---

## 1. Summary of Changed/Untracked Source Files

The current working tree contains a mix of new documentation, a significant new feature ("Legacy Registration"), and several refactors and fixes. The most critical issue is the introduction of hard-delete functions, which directly violate established business rules.

| File Path | Status | Feature / Behavior | Change Status | Findings / Recommendation |
| --- | --- | --- | --- | --- |
| `config.example.js` | Deleted | Configuration | Broken | **P2:** Restore this file. It is standard practice. |
| `src/app.js` | Modified | Routing | Complete | **Keep.** Adds route for the new legacy registration page. |
| `src/components/KioskForm.js` | Modified | Kiosk Registration | Partial | **Keep.** UI for adding a kiosk to an existing customer. Logic is in `RegistrationService`. |
| `src/components/KioskEditForm.js`| Untracked | Kiosk Management | Partial | **Keep.** New component for editing kiosk details. Appears reasonable. |
| `src/constants/navigation.js` | Modified | App Navigation | Complete | **Keep.** Adds nav link for the legacy page. |
| `src/pages/CustomerDetailPage.js` | Modified | Customer Details UI | Complete | **Keep.** Minor UI change to add a "Đăng ký thêm Kiosk" button. |
| `src/pages/KioskDetailPage.js` | Modified | Kiosk Details UI | Complete | **Keep.** Adds "Sửa kiosk" and "Gia hạn" buttons, linking to new forms. |
| `src/pages/LegacyRegistrationPage.js` | Untracked | Legacy Registration | Partial | **Keep.** New UI for the legacy registration feature. |
| `src/services/CustomerService.js` | Modified | Customer Data | **Broken/Risky** | **NEEDS_CONFIRMATION/FIX.** Adds `remove(id)` which performs a hard delete. |
| `src/services/KioskService.js` | Modified | Kiosk Data | **Broken/Risky** | **NEEDS_CONFIRMATION/FIX.** Adds `remove(id)` which performs a hard delete. |
| `src/services/RegistrationService.js` | Modified | Registration Logic | **Risky** | **FIX.** `submitExistingCustomerKiosk` contains client-side transactional logic. |
| `src/services/LegacyRegistrationService.js` | Untracked | Legacy Logic | **Broken/Risky** | **FIX.** Client-side transaction logic that uses hard-deletes for cleanup. |
| `src/styles/app.css` | Modified | Styling | Complete | **Keep.** Adds styles for new components and layouts. |
| `supabase/functions/manage-staff/index.ts`| Modified | Staff Management API | Partial | **Keep.** Minor CORS refactor. Doesn't fix the underlying security issue but is not harmful. |

---

## 2. Detailed Findings and Analysis

### P0 Critical
- **Conflict with BUSINESS_RULES.md:** The `remove(id)` functions added to `src/services/CustomerService.js` and `src/services/KioskService.js` implement hard deletes (`supabase.from(...).delete()`). This is a direct and critical violation of **Rule 8.1: "Cấm Xóa cứng"**.
- **Broken Cleanup Logic:** `src/services/LegacyRegistrationService.js` uses these hard-delete functions in its `catch` block for cleanup. This means a failed legacy import will attempt to hard-delete records, risking data loss and violating audit history rules.

### P1 High
- **Risky Client-Side Transactions:** Both `LegacyRegistrationService.js` and `RegistrationService.js` (`submitExistingCustomerKiosk` function) implement multi-step registration logic on the client. They create/update multiple tables (`customers`, `kiosks`, `payments`) sequentially. This is not atomic. If a step fails, the system can be left in an inconsistent state with orphaned records. This approach contradicts the architectural guidance in `README.md` and `AUDIT_REPORT.md` which recommends moving such logic to a single backend RPC function.
- **Security Issue:** The `AUDIT_REPORT.md` identified a lack of Row-Level Security (RLS) as a critical vulnerability. The new hard-delete functions are even more dangerous in this context, as any user with the `anon_key` could potentially call them if not properly protected at the API level (which they are not, as they are service-level functions).

### P2 Medium
- **Missing Database Dependencies:** The new client-side registration logic does not appear to update the cached/summary columns `customers.total_kiosks` and `customers.total_paid`. This violates **Rule 8.3** and will lead to data inconsistency on the customer list view.
- **Deleted `config.example.js`:** This file was deleted. It is standard practice to keep an example configuration file in the repository for new developers. It should be restored.

### P3 Low
- **Inconsistent Service Calls:** The new features continue the anti-pattern of placing complex query and business logic in frontend services rather than centralizing it in the database, as identified in `AUDIT_REPORT.md`.

---

## 3. Recommendations

### Actions
- **`CustomerService.js` & `KioskService.js`:**
    - **Recommendation:** `NEEDS_CONFIRMATION`. The owner must confirm the intent. If hard-delete is not desired, these functions should be `FIXED` to perform a soft-delete (e.g., update a status to `inactive`) or `REVERTED` entirely.
- **`LegacyRegistrationService.js` & `RegistrationService.js`:**
    - **Recommendation:** `FIX`. The multi-step creation logic must be refactored into a single, transactional RPC function in the Supabase backend. This will ensure atomicity and allow for correct, centralized updating of cached columns (`total_paid`, `total_kiosks`).
- **`config.example.js`:**
    - **Recommendation:** `REVERT`. Restore the deleted file.
- **UI Components & Pages (KioskForm, KioskEditForm, LegacyRegistrationPage, etc.):**
    - **Recommendation:** `KEEP`. The UI changes are well-structured and can be kept, but they will require the service-level fixes mentioned above to function correctly and safely.
- **`supabase/functions/manage-staff/index.ts`:**
    - **Recommendation:** `KEEP`. The change is a minor, safe refactor.

### Recommended Clean-up Order Before TASK 01
1.  **[BLOCKED]** **Confirm Deletion Policy:** Get confirmation from the Product Owner regarding the `remove()` functions. The default action should be to align with `BUSINESS_RULES.md` (no hard deletes).
2.  **[P0] Fix Hard Deletes:** Based on the PO's decision, immediately fix or revert the `remove()` functions in `CustomerService.js` and `KioskService.js`.
3.  **[P1] Refactor to RPC:** Rewrite the client-side logic in `LegacyRegistrationService.js` and `RegistrationService.js` into a backend RPC function.
4.  **[P2] Restore Config:** Run `git restore config.example.js`.
5.  **[P3] Commit Changes:** Once the critical and high-priority issues are resolved, the remaining feature (new UI components, pages, styles) can be reviewed, staged, and committed as a single, cohesive feature commit. The documentation files should be committed separately.
