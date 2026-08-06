# TASK 02: Customer Module Fix Report

- **Date:** July 25, 2026
- **Author:** Gemini
- **Purpose:** This report documents the work done to fix and complete the Customer module, as part of TASK 02.

---
*Report generated from subsequent task. Content reflects changes made during TASK 02.*
## 1. Files Modified
- `src/services/CustomerService.js`: Removed hard-delete `remove()` function and added `findDuplicates()` for validation.
- `src/pages/CustomerDetailPage.js`: Added Activate/Deactivate buttons, and integrated a full payment history section.
- `src/services/PaymentService.js`: Added `listByCustomer()` to support showing payment history.
- `src/components/CustomerForm.js`: Overhauled to remove invalid statuses, add robust validation for phone/Facebook ID, and implement a pre-save duplicate check warning.

## 2. Bugs Fixed & Business Rules Applied
- **(Rule 3.4) No Hard Delete**: Replaced hard-delete logic with a status update to 'inactive'.
- **(Rule 3.2) Duplicate Warnings**: Implemented non-blocking warnings for duplicate phone numbers and names when creating/editing customers.
- **(Rule 3.4) Correct Statuses**: Removed 'pending' from the customer status options in the form, restricting it to 'Active' and 'Inactive'.
- **(Task 3) Full CRUD**: Enhanced `CustomerDetailPage` with Activate/Deactivate actions.
- **(Task 4) Validation**: Added validation for phone number format and numeric Facebook IDs.
- **(Task 6) Customer Detail**: The detail page now shows a full list of associated payments and summary information like latest payment date.

## 3. Remaining Issues
- **Customer Reassignment**: The UI does not currently support reassigning a Kiosk from one customer to another. This was out of scope for the Customer task but is a required feature for the Kiosk task.
- **`total_kiosks` / `total_paid`**: These fields are displayed but the logic to update them is assumed to be on the backend (triggers/RPCs). There is no client-side tool to trigger a recalculation if they become inconsistent.

## 4. `git diff --stat`

```
src/components/CustomerForm.js           | 150 ++++++++++++++++++++++++++++++-----------
src/pages/CustomerDetailPage.js          | 205 +++++++++++++++++++++++++++++++++++++++----------
src/services/CustomerService.js          |  50 +++++++++++---
src/services/PaymentService.js           |  15 ++++
4 files changed, 331 insertions(+), 89 deletions(-)
```
