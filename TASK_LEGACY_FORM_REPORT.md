# TASK LEGACY FORM REPORT

## Files modified

- `src/pages/LegacyRegistrationPage.js`
  - Rebuilt the legacy-customer form and its frontend behavior.
- `src/app.js`
  - Exposed `#/legacy-registration` through the existing public shell for signed-out users.
- `src/styles/app.css`
  - Added scoped styles for the mode picker, kiosk cards, resolver states, warnings,
    confirmations, contact notice, and blocked-integration notice.
- `TASK_LEGACY_FORM_REPORT.md`
  - Added this implementation report.

No SQL, migration, RPC, Edge Function, RLS, payment workflow, or approval workflow
was created or modified.

The three implementation files already contained unrelated uncommitted work before
this task. Those existing changes were preserved.

## Implemented flow

- Public page title: `Bổ sung thông tin khách hàng cũ`.
- The page clearly states that it is only for customers not already in CRM.
- Added the required radio choice:
  - `Tôi chỉ có 1 kiosk` (default).
  - `Tôi có nhiều kiosk`.
- Single-kiosk mode:
  - Collects customer Facebook name, Facebook URL, Facebook ID, and phone.
  - Defaults `Thông tin kiosk giống thông tin khách hàng` to checked.
  - Reuses the customer Facebook name, URL, and ID without duplicate visible inputs
    while checked.
  - Reveals independent kiosk Facebook fields when unchecked.
- Multiple-kiosk mode:
  - Collects the main Facebook/contact name and phone once.
  - Starts with one required kiosk.
  - Supports `+ Thêm kiosk` and `Xóa kiosk này`.
  - Renumbers remaining kiosk cards after removal.
- Every kiosk collects Facebook name, URL, ID, business type, paid amount,
  registration date, and expiry date.
- Removed unrelated/prohibited legacy fields and actions, including Facebook group
  URL, notes, status-after-save, existing-customer kiosk action, and bill upload.
- Added both required confirmations.
- Added a double-submit guard and disables the submit button during final checks.

## Validation

- Required browser validation for all required fields.
- Facebook URLs are normalized to HTTPS `www.facebook.com` URLs and rejected when
  the host is not Facebook.
- Facebook IDs must contain digits only.
- Phone accepts 9–15 digits with an optional leading `+`; common spaces,
  parentheses, periods, and hyphens are normalized for validation.
- Paid amount must be numeric and greater than or equal to zero.
- Registration and expiry dates are required.
- Expiry date cannot be before registration date.
- At least one kiosk is required.
- Bill-through-Zalo confirmation is required.
- Final information confirmation is required.
- A kiosk cannot be submitted while its Facebook ID is unresolved.

## Duplicate behavior

- Duplicate Facebook IDs inside the form are blocking.
- Existing kiosk Facebook IDs and pending registration request Facebook IDs are
  checked through the existing `KioskService.isFacebookIdInUse` integration.
- Existing customer Facebook IDs are checked through the existing
  `CustomerService.getByFacebookId` integration.
- A detected existing customer, kiosk, or pending request blocks the form and asks
  the user to contact Admin without displaying existing personal data.
- Duplicate phone and customer/kiosk Facebook names produce warnings only.
- If duplicate checks cannot be completed safely, final submission is blocked.

## Facebook ID behavior

- Uses the existing `resolve-facebook-id` Supabase Edge Function.
- Normalizes the Facebook URL before lookup.
- Clears the ID before each lookup and never invents or preserves a fake ID after
  a failed lookup.
- Shows idle, loading, success, and error states.
- Auto-fills the numeric ID only after a successful resolver response.
- The single-kiosk copy flow uses the resolved customer Facebook ID as the kiosk ID.

## Settings/contact integration

- Loads public organization settings through the existing `SettingsService`.
- Displays `zalo_url` as the support Zalo contact.
- Falls back to `support_phone` if `zalo_url` is empty.
- Displays a clear Admin-contact fallback when neither public setting is available.
- Bill proof is handled only by the required “sent via Zalo” confirmation; no file
  is uploaded or encoded by this page.

## Blocked backend items

**BLOCKED:** There is no existing public pending-request-only integration for this
legacy form.

The existing `submit_legacy_registration` RPC cannot be used here because:

- it requires an authenticated staff user;
- it creates a customer, pending kiosk, pending payment, and legacy request directly;
- it is therefore not a public submission integration that merely records a
  pending request.

To comply with the frontend-only constraint and avoid modifying customer, kiosk,
payment, revenue, or approval data, final submission validates and checks
duplicates, then displays a clear `BLOCKED` message. It does not call
`LegacyRegistrationService.create` or any other write path.

## Tests performed

- `node --check src/pages/LegacyRegistrationPage.js` — passed.
- `node --check src/app.js` — passed.
- `git diff --check` — passed.
- Static assertions confirmed:
  - both radio options exist;
  - single-kiosk mode is the default;
  - the copy checkbox defaults checked;
  - both required confirmations exist;
  - the existing Facebook resolver is invoked;
  - there is no file input;
  - there is no call to `LegacyRegistrationService.create`.
- Reviewed the existing legacy RPC implementation to verify that it is not a
  compatible public pending-request-only write path.
- No database write test was performed because submission is intentionally blocked
  and this task prohibits backend changes.

## Git diff --stat

Focused implementation files:

```text
 src/app.js                           | 143 +++++++--
 src/pages/LegacyRegistrationPage.js | 564 ++++++++++++++++++++++++++++++------
 src/styles/app.css                   | 125 +++++++-
 3 files changed, 724 insertions(+), 108 deletions(-)
```

These counts include pre-existing uncommitted edits in `src/app.js` and
`src/styles/app.css`; only the legacy public-route and scoped legacy-form changes
were added by this task. This report is untracked and therefore is not included in
normal `git diff --stat` output.

The full dirty worktree currently reports:

```text
58 files changed, 2187 insertions(+), 4023 deletions(-)
```

Most of that full-worktree diff predates this task and was not modified for this
implementation. No commit or push was performed.
