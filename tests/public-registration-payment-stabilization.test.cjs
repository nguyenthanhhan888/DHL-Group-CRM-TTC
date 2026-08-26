const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const migration = read('supabase/migrations/20260825150000_stabilize_public_registration_payment_v2.sql');
const api = read('api/payos/create-registration-payment.js');
const service = read('src/services/RegistrationService.js');
const page = read('src/pages/RegisterPage.js');
const batchFoundation = read('supabase/migrations/20260818235900_create_public_registration_batches.sql');
const intentHardening = read('supabase/migrations/20260815120000_harden_payos_payment_intents.sql');
const webhook = read('api/payos/webhook.js');
const requestService = read('src/services/RegistrationRequestService.js');
const notifications = read('src/services/AdminNotificationService.js');
const legacy = read('supabase/migrations/20260729224250_create_public_legacy_registration_requests.sql');
const completion = read('supabase/migrations/20260825160000_complete_registration_checkout_v3.sql');

test('stabilization exposes one unique two-argument service-role RPC', () => {
  assert.equal((migration.match(/create function public\.prepare_registration_payment_v2/g) || []).length, 1);
  assert.match(migration, /public\.prepare_registration_payment_v2\(\s*request_ids_input bigint\[\],\s*phone_input text\s*\)/);
  assert.doesNotMatch(migration, /\bdefault\b|prepare_registration_batch_for_payos|pg_get_functiondef|execute\s+(?:format|definition|patched)/i);
  assert.match(migration, /security definer\s+set search_path = ''/);
  assert.match(migration, /coalesce\(auth\.jwt\(\)->>'role', ''\) <> 'service_role'/);
  assert.match(migration, /revoke all on function public\.prepare_registration_payment_v2\(bigint\[\], text\)[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.prepare_registration_payment_v2\(bigint\[\], text\)[\s\S]*to service_role/);
});

test('browser and Node checkout pass optional promotion explicitly to v3', () => {
  assert.match(page, /applyPromotion/);
  assert.match(page, /evaluate-promotion/);
  assert.match(service, /promotionCode: options\.promotionCode \|\| null/);
  assert.match(api, /rpc\/prepare_registration_checkout_v3/);
  assert.match(api, /promotion_code_input: promotionCode/);
  assert.match(completion, /prepare_registration_checkout_v3\(\s*request_ids_input bigint\[\],\s*phone_input text,\s*promotion_code_input text/);
});

test('single and multi-Kiosk totals remain authoritative with one payment', () => {
  assert.match(migration, /request_count < 1 or request_count > 20/);
  assert.match(migration, /package_record\.price_per_month \* request_record\.months/);
  assert.match(migration, /request_record\.total_amount is distinct from item_total/);
  assert.match(migration, /authoritative_total := authoritative_total \+ item_total/);
  assert.equal((migration.match(/insert into public\.payments/g) || []).length, 1);
  assert.match(migration, /total_amount = authoritative_total/);
});

test('current Promotion Engine NOT NULL columns receive neutral values', () => {
  assert.match(migration, /months, paid_months, bonus_months, effective_service_months/);
  assert.match(migration, /request_record\.months, request_record\.months, 0, request_record\.months/);
  assert.match(migration, /price_per_month, discount, total_amount, promotion_eligible/);
  assert.match(migration, /package_record\.price_per_month, 0, item_total, false/);
  assert.doesNotMatch(migration, /promotion_id|promotion_code|promotion_snapshot|promotion_usages|evaluate_registration_promotion/);
});

test('retry reuses request ownership, batch, payment, Kiosk and active provider order', () => {
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /registration_batch_id is distinct from batch_record\.id/);
  assert.match(migration, /'reused', true/);
  assert.match(batchFoundation, /payments_registration_batch_uidx/);
  assert.match(batchFoundation, /registration_batches_payment_uidx/);
  assert.match(intentHardening, /payos_orders_one_active_payment_uidx/);
  assert.match(api, /fetchExistingPayosOrder\(payment\.id\)/);
  assert.match(api, /failReservedOrder\(diagnostic\.paymentId, diagnostic\.orderCode/);
});

test('awaiting-payment is visible but remains separate from Admin review', () => {
  assert.match(requestService, /admin_list_registration_requests/);
  assert.match(notifications, /\.eq\('status', 'pending'\)/);
  assert.match(notifications, /\.eq\('status', 'awaiting_payment'\)/);
  assert.match(notifications, /registrationCount: pendingCount/);
  assert.match(completion, /'pendingReviewRequests'/);
  assert.match(completion, /'awaitingPaymentRequests'/);
  assert.match(legacy, /'request_type', 'legacy'/);
  assert.match(legacy, /'status', 'pending'/);
});

test('signed webhook remains the only completion path and is idempotent', () => {
  assert.match(webhook, /safeCompareHex\(expectedSignature, signature\)/);
  assert.match(webhook, /callSupabaseRpc\('handle_payos_webhook'/);
  assert.match(batchFoundation, /if event_record\.status='processed' then return jsonb_build_object\('already_processed',true/);
  assert.match(batchFoundation, /private\.confirm_registration_batch_from_payos/);
  assert.match(batchFoundation, /update public\.kiosks set status='active'/);
  assert.match(batchFoundation, /update public\.registration_requests set status='approved'/);
});

test('forward-only migration does not rewrite functions dynamically or touch history', () => {
  assert.doesNotMatch(migration, /\b(delete from|truncate|drop table|drop function|alter table)\b/i);
  assert.doesNotMatch(migration, /\b(?:79|94)\b/);
  assert.doesNotMatch(migration, /pg_catalog\.(?:coalesce|trim|nullif|greatest|least|extract)\s*\(?/i);
});
