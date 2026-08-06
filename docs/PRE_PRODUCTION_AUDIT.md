# Pre-production audit — CRM + TTC

Audit date: 2026-08-06
Temporary target: `https://adayroidc.com`
Decision: **NOT READY**

## Executive decision

The source builds and its automated tests pass. The audit fixed the Reviewer login gate, added the custom domain to the staff Edge Function origin allowlist, made payOS checkout fail closed behind `PAYOS_ENABLED`, restricted payOS redirects to the HTTPS `APP_BASE_URL` origin, added clean-path Vercel rewrites, and added canonical domain metadata.

Release is still blocked because this directory is not a Git checkout. Therefore the commit hash, change provenance, Git history secret scan, and `git diff --check` cannot be verified. Authenticated Admin/Reviewer/User isolation and the end-to-end payOS webhook have also not been tested with production-like accounts. Do not deploy this directory until the blockers below are closed.

`PAYOS_ENABLED` must be **false**. Although webhook code and database idempotency controls exist, Phase 2 has not been proven by a real signed payOS sandbox transaction against the target deployment. payOS is **NOT READY FOR REAL PAYMENTS**.

## Findings

| Severity | Status | Finding | Required action |
|---|---|---|---|
| Critical | Open | No `.git` directory is present; commit hash and Git history cannot be audited. | Use the authoritative Git checkout, verify the intended commit, rescan history, and rerun this audit. |
| Critical | Open | payOS webhook Phase 2 is implemented in code but has no evidence of deployment plus a successful signed end-to-end sandbox test. | Keep `PAYOS_ENABLED=false`; disable/hide payment controls or show a maintenance warning, then test creation, pending state, signed webhook, settlement, replay, and amount mismatch before enabling. |
| High | Open | Authenticated Admin/Reviewer/User authorization and row ownership were not exercised with dedicated live accounts. Migration review alone does not prove deployed RLS state. | Execute every role/ownership item in the smoke checklist against Preview before production. |
| High | Fixed | Reviewer profiles were rejected by `isProfileAllowed` before Reviewer permissions could load. | Reviewer is now accepted only when active; route access still uses database permissions. |
| High | Fixed | payOS checkout ignored `PAYOS_ENABLED`. | Checkout endpoints now fail closed with HTTP 503 unless the value is exactly `true`; webhook remains available for existing callbacks. |
| High | Fixed | payOS redirect URLs were client-controlled and did not use `APP_BASE_URL`. | Redirects must now remain on the HTTPS `APP_BASE_URL` origin. |
| High | Fixed | `https://adayroidc.com` was absent from the staff Edge Function CORS allowlist. | Custom origin added; deploy the Edge Function separately only after review. No automatic deployment was performed. |
| Medium | Open | `.env.local` contains an obsolete extra service-key alias in addition to the required service-role name. | Remove the obsolete alias locally and from deployment settings; retain only `SUPABASE_SERVICE_ROLE_KEY`. Rotate any key if it may have been exposed elsewhere. |
| Medium | Open | No automated browser/E2E suite covers CRM or TTC workflows. | Run and record the manual checklist with isolated test accounts. |
| Medium | Open | Supabase client is loaded from an unpinned CDN major (`@supabase/supabase-js@2`). | Pin an reviewed version in a later dependency-maintenance change; this audit did not change dependencies. |
| Low | Open | Node tests emit `MODULE_TYPELESS_PACKAGE_JSON` warnings. | Normalize module packaging in a later maintenance change. |
| Low | Fixed | Clean `/register` and `/legacy-registration` refreshes had no Vercel rewrites. | Rewrites now serve `index.html`; hash routes need no server rewrite. |
| Low | Fixed | Canonical/Open Graph URL metadata was absent. | Metadata now identifies `https://adayroidc.com/`. |

## Build and deployment

- `npm install`: PASS; lockfile generated; 0 audited vulnerabilities.
- `npm run build`: PASS when `.env.local` supplies the two browser variables.
- JavaScript syntax: PASS for all `.js`, `.mjs`, and `.cjs` files outside `node_modules`.
- Relative imports and `index.html` local assets: PASS; all resolved.
- `vercel.json`: PASS JSON parsing. Root directory must be the repository root and output directory is `.`. Serverless handlers remain under `/api`.
- API handler smoke: PASS for method guards and payOS-disabled behavior.
- SPA refresh: hash routes are safe; clean `/register` and `/legacy-registration` now rewrite to `/index.html`.
- Actual Vercel Preview deployment: SKIP; deployment was explicitly prohibited.

## Environment contract

Production application variables:

| Variable | Scope | Required state |
|---|---|---|
| `SUPABASE_URL` | Build + server | Required; only this URL may enter generated browser config. |
| `SUPABASE_ANON_KEY` | Build + server | Required; browser-safe public key only. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only | Required by privileged Vercel functions; never expose to browser. |
| `PAYOS_CLIENT_ID` | Server only | Configure only when testing/enabling payOS. |
| `PAYOS_API_KEY` | Server only | Configure only on server. |
| `PAYOS_CHECKSUM_KEY` | Server only | Required by checkout and webhook; server only. |
| `PAYOS_ENABLED` | Server only | Set to `false` for this release. Checkout is enabled only by exact value `true`. |
| `APP_BASE_URL` | Server only | Set to `https://adayroidc.com`. Redirects reject a different origin. |

`scripts/generate-config.mjs` publishes only `SUPABASE_URL` and `SUPABASE_ANON_KEY` as `supabaseUrl` and `supabaseAnonKey`. No payOS or service-role value is added to browser config. Local secret-bearing files are ignored, but the absence of Git metadata prevents proof that they were never committed historically.

## Authentication, permissions, and RLS

Static review found:

- direct routes use the same `canAccess` decision as sidebar filtering;
- Admin receives all frontend routes; Reviewer receives only `get_my_permissions()` routes; User receives only user/TTC surfaces;
- user wallet, ledger, profiles, campaigns, tasks, and related logs have ownership predicates in the migrations;
- wallet non-negative checks, row locking, ledger idempotency, campaign idempotency, and task uniqueness are implemented in database code;
- privileged payOS webhook execution is revoked from `public`, `anon`, and `authenticated` and granted to `service_role` in the migration;
- a live anonymous probe returned HTTP 401 for wallet, campaign creation, payOS order recording, and webhook RPCs.

Limit: no authenticated production-like Admin/Reviewer/User credentials were provided. Cross-user reads/writes and exact deployed policy definitions remain manual blockers.

## CRM and TTC smoke status

Automated/unit coverage passed for Facebook ID validation/resolution UI, form validation, build config isolation, Vercel handler method guards, payOS gating, and redirect origin enforcement.

Login/logout, customers, kiosks, public registration, renewal payment, payment history, categories, business types, reports, wallet balance/history, task list, campaign creation/history, and cross-user separation are **SKIP** pending a Vercel Preview and dedicated role accounts. Follow `PRODUCTION_SMOKE_TEST_CHECKLIST.md`; do not interpret source review as a live smoke-test pass.

## payOS status

- Phase 1 checkout creation: implemented; request signing and pending-order recording exist.
- Existing public-registration pending checkout reuse: implemented using the latest pending `payos_orders` record.
- CRM amount source: validated against the database by `record_payos_payment_link`; public registration reads `payments.total_amount` server-side. Wallet top-up amount remains user-selected by the existing rule.
- Before webhook: order/payment remain pending by design.
- `PAYOS_ENABLED`: now enforced server-side and reported as `PAYOS_DISABLED`/HTTP 503 when off.
- Webhook: implemented with signature verification, amount matching, service-role-only RPC, event idempotency, and duplicate-paid protection in source/migrations.
- Deployment/test proof: absent.

Classification: **NOT READY FOR REAL PAYMENTS**. Set `PAYOS_ENABLED=false` and disable the payment button or display a maintenance warning until Phase 2 passes the checklist.

## Domain readiness

- No application hard-coded `vercel.app` URL was found; one placeholder remains only in deployment documentation.
- payOS return/cancel URLs are anchored to `APP_BASE_URL`.
- staff Edge Function allows `https://adayroidc.com`.
- canonical and `og:url` metadata use the custom domain.
- runtime assets use HTTPS or same-origin relative paths; localhost HTTP entries are development-only.

## Test record

| Check | Result | Evidence |
|---|---|---|
| `npm install` | PASS | Completed; 0 vulnerabilities. |
| `npm run build` | PASS | Generated browser config from public values only. |
| `npm test` | PASS | See final rerun; no skipped automated tests. |
| JavaScript `node --check` | PASS | All repository JS/MJS/CJS files checked. |
| Missing import/asset scan | PASS | No unresolved relative path. |
| `npm audit --omit=dev` | PASS | 0 production vulnerabilities. |
| `npm audit` | PASS | 0 total vulnerabilities. |
| Secret pattern scan | PASS with limitation | Findings were limited to ignored local configuration; no server secret pattern was found in frontend source. Git history unavailable. |
| Anonymous privileged RPC probes | PASS | Live endpoints denied anonymous calls with HTTP 401. |
| `git diff --check` | SKIP/BLOCKED | Not a Git repository. |
| Git history secret scan | SKIP/BLOCKED | Not a Git repository. |
| Vercel Preview/manual smoke | SKIP | No deploy and no role credentials, per scope. |
| Real payOS sandbox webhook | SKIP/BLOCKED | No deployed target/webhook test evidence. |

## Exact manual deployment steps

1. Obtain the authoritative Git checkout. Confirm `git status --short`, `git rev-parse HEAD`, and the intended branch/remote. Do not copy `.env.local`, `config.local.js`, or generated `config.js` into Git.
2. Apply/review the changed files listed below in that checkout. Run `git diff --check` and a Git-history secret scanner. If any server key ever entered Git, rotate it before proceeding.
3. Remove the obsolete local/deployment `SUPABASE_SERVICE_KEY` alias. Configure exactly the eight variables listed above in Vercel; set `APP_BASE_URL=https://adayroidc.com` and `PAYOS_ENABLED=false`. Ensure only the two public Supabase values are available during the browser-config build.
4. In Vercel, import the authoritative repository. Set Root Directory to the repository root, Framework Preset to Other, Build Command to `npm run build`, and Output Directory to `.`. Do not deploy from this unaudited folder.
5. Create a Vercel Preview deployment. Confirm `/`, `/register`, `/legacy-registration`, `/api/facebook-id`, and the protected API method behavior. Confirm source maps, logs, and built files contain no server-only values.
6. Map and verify `adayroidc.com` in Vercel, then configure the DNS records Vercel specifies. Confirm the TLS certificate is active and HTTPS redirects correctly.
7. In Supabase Auth URL Configuration, set Site URL to `https://adayroidc.com` and add only required Preview/custom-domain redirect URLs. Review rather than automatically changing production.
8. Review and manually deploy the updated `manage-staff` Edge Function if that function is part of production. Do not apply database migrations automatically; compare deployed migration history and policies first.
9. Run every item in `docs/PRODUCTION_SMOKE_TEST_CHECKLIST.md` using isolated Admin, Reviewer, User A, and User B accounts. Record IDs and timestamps, but never secrets.
10. Keep payOS disabled for the temporary release. In a separate Preview/sandbox exercise, register the webhook URL, complete a real test payment, verify pending-before-webhook and completed-after-webhook, replay the webhook, and test wrong amount/signature. Enable only after all results pass.
11. After blockers close, commit intentionally, record the commit SHA in this report, deploy that exact SHA, and rerun the post-deployment smoke subset.

## Files changed by this audit

- `api/payos/_utils.js`
- `api/payos/create-payment.js`
- `api/payos/create-registration-payment.js`
- `index.html`
- `package-lock.json` (generated by `npm install`)
- `scripts/seed-qa-live.mjs`
- `scripts/seed-ttc-admin-demo.mjs`
- `scripts/simulate-payos-webhook.cjs`
- `src/app.js`
- `supabase/functions/manage-staff/index.ts`
- `tests/payos-config.test.cjs`
- `tests/vercel-api.test.cjs`
- `vercel.json`
- `docs/PRE_PRODUCTION_AUDIT.md`
- `docs/PRODUCTION_SMOKE_TEST_CHECKLIST.md`

Commit hash: **UNAVAILABLE — directory is not a Git repository.**
