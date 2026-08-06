# Production smoke-test checklist — CRM + TTC

Target: `https://adayroidc.com`
Run first on Vercel Preview, then repeat the marked safe checks on the custom domain. Use isolated Admin, Reviewer, User A, and User B accounts. Never paste tokens or keys into this document.

## Release evidence

- [ ] Record commit SHA and Preview deployment URL.
- [ ] Confirm `PAYOS_ENABLED=false` and `APP_BASE_URL=https://adayroidc.com`.
- [ ] Confirm Vercel Root Directory is the repository root, Build Command is `npm run build`, and Output Directory is `.`.
- [ ] Confirm browser-loaded `config.js` contains only the Supabase URL and public anon key.
- [ ] Confirm no server keys appear in HTML, JS, source maps, network responses, or logs.
- [ ] Confirm `/`, `/register`, and `/legacy-registration` refresh without 404.
- [ ] Confirm HTTPS, valid certificate, canonical URL, and no mixed-content browser warnings.

## Authentication and route permissions

- [ ] Admin login succeeds; logout clears the session and protected routes return to login.
- [ ] Active Reviewer login succeeds and loads only the permissions assigned by `get_my_permissions`.
- [ ] Remove one Reviewer permission; direct hash URL and sidebar entry are both denied after refresh/session permission refresh.
- [ ] Locked/inactive accounts cannot enter protected routes.
- [ ] Anonymous direct URLs for Admin, Reviewer, User, and TTC pages cannot bypass login.
- [ ] User A cannot read or mutate User B records by changing URL IDs or API/RPC parameters.

## CRM

- [ ] Customers: Admin list, search, open detail, create/update using disposable data, and verify expected validation.
- [ ] Kiosks: Admin list, detail, create/update using disposable data, and verify customer/business-type association.
- [ ] Public kiosk registration: submit disposable valid data and confirm a pending request; verify duplicate/invalid input handling.
- [ ] Public legacy registration: submit or validate the intended pending-review flow.
- [ ] Registration review: authorized role can review; unauthorized Reviewer cannot call the underlying RPC directly.
- [ ] Renewal: create a pending payment and confirm kiosk dates/status do not change before payment confirmation.
- [ ] Payment history/detail: authorized users see expected records; User sees only owned payments.
- [ ] Categories and business types: Admin can view/manage; unauthorized roles cannot mutate directly.
- [ ] Reports/dashboard: totals and filters match a direct approved database comparison.
- [ ] Facebook ID endpoint: POST a valid Facebook URL, verify response shape, invalid-domain rejection, timeout handling, and GET 405.

## TTC

- [ ] Wallet balance equals the sum represented by the ledger and never becomes negative.
- [ ] User sees only their wallet and transaction history.
- [ ] Task list shows eligible/assigned tasks according to existing rules.
- [ ] Claim and submit a disposable task; User B cannot submit User A's task.
- [ ] Create a disposable campaign and verify the database-calculated debit, tasks, and history.
- [ ] Repeat the same campaign idempotency key; verify no duplicate campaign or debit.
- [ ] Replay task verification; verify no duplicate reward.
- [ ] Attempt a campaign exceeding balance; verify the transaction fails and no partial rows/debit remain.
- [ ] Admin TTC operations require Admin or the precise `admin-ttc` permission at the database layer.

## RLS and privileged RPC tests

- [ ] With anon key only, wallet/campaign/task/payOS privileged RPCs return 401/403.
- [ ] With User A token, direct table reads return only User A profile, kiosks/payments, wallet, campaigns, and related tasks/logs.
- [ ] With User B token and User A IDs, reads return no rows and mutations fail.
- [ ] Reviewer without a module permission cannot call that module's RPC directly.
- [ ] Reviewer with the permission can perform only the documented operations.
- [ ] `handle_payos_webhook` cannot be executed by anon or authenticated roles.
- [ ] Compare live policies, grants, function security mode, and migration history with repository SQL before approval. Do not auto-apply migrations.

## payOS Phase 1 while disabled

- [ ] Payment controls are disabled/hidden or show a clear maintenance warning.
- [ ] Direct POST to checkout endpoints returns HTTP 503 with `PAYOS_DISABLED`.
- [ ] Existing payment and wallet data remain accessible; disabling checkout does not disable webhook receipt for already-created orders.

## payOS Phase 2 sandbox gate — required before real payments

- [ ] Use payOS sandbox/testing credentials and a Preview/custom-domain webhook registered to `/api/payos/webhook`.
- [ ] Checkout amount for CRM equals the database payment amount; tampered client amount is rejected.
- [ ] Existing pending public-registration checkout is reused instead of creating another provider order.
- [ ] Payment and order remain pending before the signed webhook.
- [ ] Valid paid webhook changes exactly the intended payment/wallet state.
- [ ] Invalid signature is rejected and changes nothing.
- [ ] Wrong amount is rejected and changes nothing.
- [ ] Replay the same webhook; no duplicate payment confirmation, wallet credit, reward, or audit event effect occurs.
- [ ] Capture sanitized provider/dashboard evidence and application timestamps.
- [ ] Only after every Phase 2 item passes: approve changing `PAYOS_ENABLED` to `true` in a separate release decision.

## Post-deployment

- [ ] Repeat login/logout, role route denial, User A/User B separation, public registration, Facebook ID, reports, wallet/history, and campaign idempotency checks on `https://adayroidc.com`.
- [ ] Inspect Vercel Function logs for errors without copying sensitive request headers or payloads.
- [ ] Confirm DNS/TLS and Supabase Auth redirect behavior from a clean browser session.
- [ ] Record PASS/FAIL/SKIP, tester, timestamp, and issue link for every item.

Release rule: any failed authorization, ownership, balance, idempotency, secret exposure, build, or routing check is a blocker. Until payOS Phase 2 passes, keep `PAYOS_ENABLED=false`.
