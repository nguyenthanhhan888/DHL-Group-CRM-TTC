const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const migration = read('supabase/migrations/20260825140000_fix_public_registration_payment_recovery.sql');
const api = read('api/payos/create-registration-payment.js');
const requestService = read('src/services/RegistrationRequestService.js');
const notifications = read('src/services/AdminNotificationService.js');
const legacy = read('supabase/migrations/20260729224250_create_public_legacy_registration_requests.sql');

test('Promotion Engine batch columns are populated before their NOT NULL constraints', () => {
  assert.match(migration, /months,\s*paid_months,\s*bonus_months,\s*effective_service_months/);
  assert.match(migration, /request_record\.months,\s*request_record\.months,\s*0,\s*request_record\.months/);
  assert.match(migration, /promotion_eligible/);
});

test('migration uses explicit function bodies and no definition text rewriting', () => {
  assert.doesNotMatch(migration, /pg_get_functiondef|pg_catalog\.replace|execute\s+patched/i);
  assert.match(migration, /create or replace function private\.prepare_registration_batch_for_payos/);
  assert.match(migration, /create or replace function public\.submit_registration_request/);
  assert.match(migration, /create or replace function public\.submit_public_registration/);
});

test('private base preserves the authoritative batch contract and public wrapper topology', () => {
  for (const contract of [
    /pg_advisory_xact_lock/,
    /package_record\.price_per_month \* request_record\.months/,
    /request_record\.total_amount is distinct from item_total/,
    /insert into public\.customers/,
    /insert into public\.kiosks/,
    /insert into public\.registration_batches/,
    /insert into public\.payments/,
    /'reused', true/,
  ]) assert.match(migration, contract);
  assert.doesNotMatch(migration, /create or replace function public\.prepare_registration_batch_for_payos/);
  assert.doesNotMatch(migration, /promotion_code_input\s+text\s+default/i);
  assert.match(migration, /revoke all on function private\.prepare_registration_batch_for_payos\(bigint\[\], text\)[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute on function private\.prepare_registration_batch_for_payos\(bigint\[\], text\)[\s\S]*to service_role/);
});

test('public PayOS requests use a separate waiting-for-payment state', () => {
  assert.match(migration, /check \(status in \('awaiting_payment', 'pending', 'approved', 'rejected'\)\)/);
  assert.match(migration, /'transfer', 'awaiting_payment'/);
  assert.match(migration, /'workflow', 'public_payos'/);
  assert.match(migration, /not in \('awaiting_payment',\s*'pending',\s*'approved'\)/);
});

test('Admin queue exposes awaiting-payment separately from Admin-review pending', () => {
  assert.match(requestService, /admin_list_registration_requests/);
  assert.match(notifications, /\.eq\('status', 'pending'\)/);
  assert.match(notifications, /\.eq\('status', 'awaiting_payment'\)/);
  assert.match(notifications, /registrationCount: pendingCount/);
  assert.match(notifications, /awaitingPaymentCount: awaitingCount/);
});

test('identical retry reuses request, batch, payment, and active provider order', () => {
  assert.match(migration, /select r\.id into request_id_value[\s\S]*r\.status = 'awaiting_payment'/);
  assert.match(migration, /r\.payment_id is null[\s\S]*or exists[\s\S]*p\.payment_status = 'pending'/);
  assert.match(migration, /used_request_ids/);
  assert.match(api, /fetchExistingPayosOrder\(payment\.id\)/);
});

test('failed provider creation releases only an unpaid empty reservation', () => {
  assert.match(migration, /create or replace function public\.fail_registration_payos_order/);
  assert.match(migration, /o\.status = 'pending'[\s\S]*o\.checkout_url is null[\s\S]*p\.payment_status = 'pending'/);
  assert.match(migration, /grant execute on function public\.fail_registration_payos_order\(bigint,\s*bigint,\s*text\)[\s\S]*to service_role/);
  assert.match(api, /failReservedOrder\(diagnostic\.paymentId, diagnostic\.orderCode/);
});

test('safe server diagnostics expose every registration payment stage', () => {
  for (const stage of ['SUBMIT_REQUEST', 'PREPARE_BASE_PRICING', 'PREPARE_PAYMENT', 'CREATE_PAYOS_ORDER', 'RECORD_PAYOS_ORDER', 'RETURN_CHECKOUT']) {
    assert.match(api, new RegExp(`['"]${stage}['"]`));
  }
  for (const field of ['requestIds', 'batchId', 'paymentId', 'payosReached']) assert.match(api, new RegExp(`${field}:`));
  assert.match(api, /safeDiagnostic/);
});

test('legacy registrations keep explicit Admin review semantics', () => {
  assert.match(legacy, /'request_type', 'legacy'/);
  assert.match(legacy, /'status', 'pending'/);
  assert.doesNotMatch(migration, /submit_public_legacy_registration[\s\S]*awaiting_payment/);
});
