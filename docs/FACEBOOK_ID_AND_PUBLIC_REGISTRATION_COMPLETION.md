# Facebook ID and public registration completion

## Completed routes

- `#/register` is implemented by `src/pages/RegisterPage.js`.
- `#/legacy-registration` is implemented by `src/pages/LegacyRegistrationPage.js`.
- No alternative public routes or duplicate pages were created.

## Files changed

- `src/components/FacebookIdResolver.js`
- `src/pages/RegisterPage.js`
- `src/pages/LegacyRegistrationPage.js`
- `src/services/FacebookIdService.js`
- `src/services/RegistrationService.js`
- `src/services/LegacyRegistrationService.js`
- `src/styles/app.css`
- `src/utils/formValidation.js`
- `tests/form-validation.test.mjs`
- `supabase/migrations/20260730154825_enforce_public_registration_facebook_ids.sql`
- `docs/FACEBOOK_ID_AND_PUBLIC_REGISTRATION_COMPLETION.md`

## Shared implementation

`FacebookIdResolverFields`, `bindFacebookIdResolvers`, and
`validateFacebookResolver` provide independent resolver state for every kiosk.
`resolveFacebookId(facebookUrl)` is exported by `FacebookIdService.js` and calls
only `POST /api/facebook-id`.

Resolver states are `idle`, `loading`, `success`, `invalid-url`, `not-found`,
`timeout`, `upstream-error`, and `manual`. A successful ID remains visible.
Changing a successfully resolved URL clears the old ID and requires a new
resolution. Public manual entry is unlocked only after automatic resolution
fails. Requests are disabled while in flight.

Shared validation helpers cover phone numbers, digit-only IDs, duplicates,
date-only values, and inline errors. Shared currency formatting uses `vi-VN`
and `VND`.

## Public registration form

Customer fields: contact name, Facebook display name, phone, address, and note.
Email was not added because the current backend does not persist it.

Every kiosk independently contains Facebook display name, URL/ID resolver,
category, filtered business type, months, discount and reason, current monthly
price, calculated subtotal, and note. Users can add/remove 1–20 kiosks. The
mobile-visible total is the sum of kiosk subtotals.

Final validation requires all fields defined by the workflow, valid phone and
Facebook URL, digit-only ID, unique IDs in the form, category/business type,
1–120 months, and a valid discount. Double submission is blocked.

Submission calls the existing atomic `submit_public_registration` RPC. The RPC
creates pending registration requests. It does not activate kiosks or create a
completed payment. Duplicate checks are performed inside the transaction and
return only a generic conflict, never existing customer data.

## Legacy registration form

Customer fields: contact/Facebook name, previously used phone, Facebook profile
URL/ID resolver, and optional note.

Each historical kiosk contains Facebook display name, URL/ID resolver,
category, filtered business type, original start date, known end date,
historical paid amount, and note/evidence. Amounts must be numeric and
non-negative. Dates must be real `YYYY-MM-DD` values and end cannot precede
start. IDs must be digit-only and unique in the form.

Submission calls the existing atomic `submit_public_legacy_registration` RPC
and creates pending review requests only. Historical values are submitted as
declared. No payment is completed and no kiosk is activated or renewed before
admin approval.

## API contract

Request:

```json
{ "facebook_url": "https://www.facebook.com/..." }
```

Success:

```json
{
  "success": true,
  "facebook_id": "...",
  "facebook_url": "..."
}
```

Errors are normalized to `{ success: false, code, message }`. Browser code
contains no direct request to Traodoisub; only the Vercel Function contains the
upstream URL.

## Verification results

- Node syntax checks passed for both pages, shared resolver, and services.
- Facebook Function/resolver tests: 9 passed.
- Shared validation tests: 3 passed.
- `git diff --check`: passed.
- Source scan: no direct Traodoisub request in `src/` or `index.html`.
- Production read-only inspection confirmed both RPCs are atomic, executable by
  `anon`, require numeric Facebook IDs, check existing/pending duplicates, and
  return pending state.

Browser visual testing was blocked because no connected browser was available
in this session. The database migration was also not deployed because the
production mutation approval was rejected. The migration file remains ready
for owner-reviewed deployment.

## Manual production checks

1. Deploy the frontend commit and apply
   `20260730154825_enforce_public_registration_facebook_ids.sql` after review.
2. Open `#/register` at desktop, tablet, and mobile widths.
3. Resolve one valid URL, change the URL, and confirm the old ID clears.
4. Test invalid URL, not-found, timeout/upstream failure, retry, manual fallback,
   and rapid double-click.
5. Add two kiosks with different categories/packages and confirm independent
   prices and total; try a duplicate ID and invalid required fields.
6. Submit one test registration and confirm only pending registration requests
   exist; no active kiosk or completed payment should be created.
7. Repeat the resolver, duplicate, date-range, amount, multi-kiosk, failure
   preservation, and success checks on `#/legacy-registration`.
8. Confirm the legacy request remains pending and retains historical values.
9. Check browser console/network: no console errors and the only resolver
   request is `POST /api/facebook-id`.
