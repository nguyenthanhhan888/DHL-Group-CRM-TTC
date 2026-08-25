const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const hotfix = read('supabase/migrations/20260825130000_fix_registration_payment_rpc_overload.sql');
const engine = read('supabase/migrations/20260824170000_create_discount_promotion_engine_v1.sql');
const batch = read('supabase/migrations/20260818235900_create_public_registration_batches.sql');
const intent = read('supabase/migrations/20260815120000_harden_payos_payment_intents.sql');
const api = read('api/payos/create-registration-payment.js');

test('production hotfix leaves exactly one public payment-preparation signature', () => {
  assert.match(hotfix, /alter function public\.prepare_registration_batch_for_payos\(bigint\[\], text\)\s+set schema private/);
  assert.match(hotfix, /drop function if exists public\.prepare_registration_batch_for_payos\(bigint\[\], text\);/);
  assert.match(hotfix, /drop function if exists public\.prepare_registration_batch_for_payos\(bigint\[\], text, text\);/);
  assert.doesNotMatch(hotfix, /drop function[^;]+cascade/i);
  assert.match(hotfix, /create function public\.prepare_registration_batch_for_payos\([\s\S]*promotion_code_input text\s*\)/);
  assert.equal((hotfix.match(/create function public\.prepare_registration_batch_for_payos/g) || []).length, 1);
  assert.doesNotMatch(hotfix, /promotion_code_input text default/);
  assert.match(hotfix, /result := private\.prepare_registration_batch_for_payos\(request_ids_input, phone_input\)/);
  assert.doesNotMatch(hotfix, /result := public\.prepare_registration_batch_for_payos\(request_ids_input, phone_input\)/);
  assert.match(hotfix, /security definer\s+set search_path = ''/);
  assert.match(hotfix, /coalesce\(auth\.jwt\(\)->>'role', ''\) <> 'service_role'/);
  assert.match(hotfix, /revoke all on function public\.prepare_registration_batch_for_payos\(bigint\[\], text, text\)\s+from public, anon, authenticated/);
  assert.match(hotfix, /grant execute on function public\.prepare_registration_batch_for_payos\(bigint\[\], text, text\)\s+to service_role/);
});

test('normal checkout without promotion remains valid and server-authoritative', () => {
  assert.match(api, /promotion_code_input: promotionCode \|\| null/);
  assert.match(engine, /if normalized_code = '' then[\s\S]*'valid',true[\s\S]*'discountAmount',0[\s\S]*'finalAmount',subtotal/);
  assert.match(batch, /package_record\.price_per_month\*request_record\.months/);
  assert.match(batch, /request_record\.total_amount is distinct from item_total/);
});

test('percentage, fixed and bonus-month promotions retain payment preparation contracts', () => {
  for (const type of ['percentage', 'fixed_amount', 'bonus_months']) assert.match(engine, new RegExp(`'${type}'`));
  assert.match(engine, /discount_total := pg_catalog\.floor\(eligible_total \* promotion_record\.discount_value \/ 100\.0\)::bigint/);
  assert.match(engine, /discount_total := least\(eligible_total,promotion_record\.discount_value\)/);
  assert.match(engine, /'effectiveMonths',item_months \+ case when eligible and promotion_record\.discount_type='bonus_months'/);
  assert.match(hotfix, /update public\.payments[\s\S]*total_amount = \(evaluation->>'finalAmount'\)::bigint/);
});

test('invalid promotions reject before PayOS and transactionally roll back preparation', () => {
  assert.match(hotfix, /if not coalesce\(\(evaluation->>'valid'\)::boolean, false\) then\s*raise exception/s);
  assert.match(api, /diagnostic\.stage = 'PREPARE_BATCH'/);
  assert.ok(api.indexOf("PREPARE_BATCH") < api.indexOf("CREATE_PAYOS_ORDER"));
});

test('duplicate and failed-attempt retries preserve one financial intent', () => {
  assert.match(batch, /pg_advisory_xact_lock/);
  assert.match(batch, /'reused',true/);
  assert.match(batch, /payments_registration_batch_uidx/);
  assert.match(intent, /payos_orders_one_active_payment_uidx/);
  assert.match(api, /fetchExistingPayosOrder\(payment\.id\)/);
  assert.match(api, /expires_at: `gt\.\$\{new Date\(\)\.toISOString\(\)\}`/);
});

test('multi-Kiosk payment remains one authoritative sum', () => {
  assert.match(batch, /request_count<1 or request_count>20/);
  assert.match(batch, /authoritative_total:=authoritative_total\+item_total/);
  assert.equal((batch.match(/insert into public\.payments/g) || []).length, 1);
  assert.match(hotfix, /sum\(e\.base_discount\) over \(\)/);
});

test('PayOS failure diagnostics identify the recoverable stage without leaking secrets', () => {
  for (const field of ['stage', 'requestIds', 'batchId', 'paymentId', 'payosReached']) assert.match(api, new RegExp(`${field}:`));
  assert.match(api, /providerError\.code = 'PAYOS_CREATE_FAILED'/);
  assert.match(api, /safeDiagnostic/);
  assert.match(api, /REGISTRATION_BATCH_PAYOS_FAILED/);
  assert.doesNotMatch(api, /console\.error\([^\n]*PAYOS_(?:API_KEY|CHECKSUM_KEY|CLIENT_ID)/);
});
