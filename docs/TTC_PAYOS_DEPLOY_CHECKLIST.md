# TTC + PayOS Deploy Checklist

## Migration Order

Run these migrations against staging first, then production after verification:

1. `supabase/migrations/20260731090000_create_ttc_user_wallet_foundation.sql`
2. `supabase/migrations/20260731093000_harden_ttc_user_wallet_foundation.sql`
3. `supabase/migrations/20260731100000_create_payos_order_foundation.sql`
4. `supabase/migrations/20260731103000_seed_ttc_payos_permissions.sql`

Do not skip the existing CRM/Kiosk payment workflow migrations already required by the app.

## Vercel Environment

Set these as backend/deployment environment variables. Do not place real values in frontend files.

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SERVICE_KEY`
- `PAYOS_CLIENT_ID`
- `PAYOS_API_KEY`
- `PAYOS_CHECKSUM_KEY`

Frontend build still only needs public Supabase values through the existing generated config path.

## PayOS Webhook

Configure PayOS webhook URL after deployment:

```text
https://<production-domain>/api/payos/webhook
```

The webhook verifies PayOS signature server-side, then calls the database RPC. Frontend must not confirm CRM payments or credit wallet balance directly.

## Post-Deploy SQL Audit

Run:

```text
docs/audit/PAYOS_PAYMENT_DATA_INTEGRITY_CHECKS.sql
```

Review every returned row before handing to the customer. Expected result is zero rows for mismatch queries after a clean deploy and controlled test data.

## Manual Flow Test

1. Login as Admin.
2. Confirm Admin sees `Quản trị TTC`.
3. Login as Reviewer with `admin-ttc` permission.
4. Confirm Reviewer can open `#/admin/ttc`.
5. Login as user account.
6. Open `#/user`, save profile, add Facebook link, verify wallet panel loads.
7. Admin adds wallet credit through `#/admin/ttc`.
8. User opens `#/ttc`, creates a campaign, confirms wallet spend is written through RPC.
9. Another user receives a task, submits evidence.
10. Admin approves and rejects submitted tasks, confirms wallet ledger and task logs are written.
11. Create a CRM/Kiosk pending payment through the existing renewal/registration flow.
12. On `#/payments`, create PayOS for that pending payment.
13. Complete PayOS sandbox/payment, confirm webhook marks CRM payment completed through database.
14. In `#/user`, create PayOS wallet topup.
15. Complete PayOS sandbox/payment, confirm webhook credits wallet ledger through database.

## Production Gates

- No real PayOS/Supabase secret appears in committed files.
- `npm test` passes.
- `git diff --check` passes.
- `npm run build` passes in an env with `SUPABASE_URL` and `SUPABASE_ANON_KEY`.
- Browser smoke test covers desktop and mobile widths for `#/payments`, `#/user`, `#/ttc`, and `#/admin/ttc`.
