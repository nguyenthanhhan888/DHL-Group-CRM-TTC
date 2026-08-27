const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const sql = read('supabase/migrations/20260825160000_complete_registration_checkout_v3.sql');
const api = read('api/payos/create-registration-payment.js');
const webhook = read('api/payos/webhook.js');
const page = read('src/pages/RegistrationRequestsPage.js');
const requestService = read('src/services/RegistrationRequestService.js');
const notifications = read('src/services/AdminNotificationService.js');
const reports = read('src/pages/ReportsPage.js');
const register = read('src/pages/RegisterPage.js');

test('v3 is the single explicit current service-role checkout signature', () => {
  assert.equal((sql.match(/create function public\.prepare_registration_checkout_v3/g) || []).length, 1);
  assert.match(sql, /prepare_registration_checkout_v3\(\s*request_ids_input bigint\[\],\s*phone_input text,\s*promotion_code_input text\s*\)/);
  assert.doesNotMatch(sql, /promotion_code_input text default/i);
  assert.match(sql, /revoke all on function public\.prepare_registration_checkout_v3\(bigint\[\], text, text\)[\s\S]*grant execute[\s\S]*to service_role/);
  for (const oldRpc of ['prepare_registration_payment_v2', 'prepare_registration_batch_for_payos', 'prepare_registration_payment_for_payos']) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${oldRpc}`));
  }
  assert.doesNotMatch(sql, /pg_get_functiondef|execute\s+(?:format|patched|definition)|\bcascade\b/i);
});

test('normal and promotion pricing share one authoritative transaction', () => {
  assert.match(sql, /item_total := package_record\.price_per_month \* request_record\.months/);
  assert.match(sql, /request_record\.total_amount is distinct from item_total/);
  assert.match(sql, /request_record\.months, request_record\.months, 0, request_record\.months/);
  assert.match(sql, /package_record\.price_per_month, 0, item_total, false/);
  assert.match(sql, /private\.evaluate_registration_promotion/);
  assert.match(sql, /promotion_snapshot = evaluation/);
  assert.match(sql, /batch_record\.total_amount is distinct from[\s\S]*sum\(i\.total_amount\)/);
  assert.match(sql, /effective_service_months = coalesce\(\(x\.value->>'effectiveMonths'\)::integer, i\.months\)/);
});

test('API always sends the third argument and creates PayOS only after DB preparation', () => {
  assert.match(api, /prepare_registration_checkout_v3/);
  assert.match(api, /promotion_code_input: promotionCode/);
  assert.match(api, /return code \|\| null/);
  assert.ok(api.indexOf("PREPARE_BASE_PRICING") < api.indexOf("CREATE_PAYOS_ORDER"));
  assert.match(api, /fetchExistingPayosOrder\(payment\.id\)/);
  assert.match(api, /failReservedOrder\(diagnostic\.paymentId, diagnostic\.orderCode/);
});

test('retry and cross-flow duplicate contracts are serialized and idempotent', () => {
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /registration_batch_id is distinct from batch_record\.id/);
  assert.match(sql, /'reused', true/);
  assert.match(sql, /r\.status = 'pending'[\s\S]*new\.status = 'awaiting_payment' and r\.status = 'awaiting_payment'/);
  assert.doesNotMatch(sql, /r\.status in \('pending', 'awaiting_payment'\)/);
  assert.match(sql, /guard_legacy_approval_against_live_public_checkout/);
  assert.match(sql, /finalize_cancelled_public_kiosk_from_legacy/);
  assert.match(sql, /cancelled_public\.status = 'cancelled'/);
  assert.match(sql, /completed_payment\.payment_status = 'completed'/);
});

test('Admin external completion records real external payment and finalizes exactly once', () => {
  assert.match(sql, /create function public\.admin_complete_awaiting_registration/);
  assert.match(sql, /pg_catalog\.lower\(ur\.role\) = 'admin'/);
  assert.match(sql, /payment_method = 'external'/);
  assert.match(sql, /payment_status = 'completed'/);
  assert.match(sql, /where o\.payment_id = payment_record\.id and o\.status = 'paid'/);
  assert.match(sql, /'already_completed', true/);
  assert.match(sql, /'manual_accept'/);
  assert.match(sql, /update public\.kiosks[\s\S]*status = 'active'/);
});

test('Admin cancellation preserves history and refuses paid or active records', () => {
  assert.match(sql, /create function public\.admin_cancel_awaiting_registration/);
  assert.match(sql, /payment_record\.payment_status = 'completed'/);
  assert.match(sql, /k\.status = 'active'/);
  assert.match(sql, /set status = 'cancelled'/);
  assert.match(sql, /'already_cancelled', true/);
  assert.match(sql, /'admin_cancel'/);
  assert.doesNotMatch(sql, /delete from public\.(registration_requests|registration_batches|payments|payos_orders|kiosks)/i);
});

test('Admin UI exposes request-centric filters, payment states and safe dialogs', () => {
  for (const label of ['Tất cả', 'Chờ thanh toán', 'Chờ duyệt', 'Đã hoàn tất', 'Đã từ chối / Đã hủy']) assert.match(page, new RegExp(label));
  for (const stateLabel of ['Chưa tạo liên kết thanh toán', 'Đang chờ khách thanh toán', 'Link thanh toán hết hạn', 'Tạo PayOS thất bại']) assert.match(page, new RegExp(stateLabel));
  assert.match(page, /Modal\.open/);
  assert.match(page, /Đang xử lý\.\.\./);
  assert.match(page, /batch_item_count/);
  assert.match(page, /batch_total_amount/);
  assert.match(requestService, /admin_complete_awaiting_registration/);
  assert.match(requestService, /admin_cancel_awaiting_registration/);
});

test('reports and notifications keep all four pending concepts separate', () => {
  for (const key of ['pendingPayments', 'awaitingPaymentRequests', 'pendingKiosks', 'pendingReviewRequests']) assert.match(sql, new RegExp(`'${key}'`));
  for (const label of ['Giao dịch Pending', 'Hồ sơ chờ thanh toán', 'Kiosk chờ duyệt', 'Hồ sơ chờ duyệt']) assert.match(reports, new RegExp(label));
  assert.match(notifications, /pendingReviewCount: pendingCount/);
  assert.match(notifications, /awaitingPaymentCount: awaitingCount/);
  assert.match(notifications, /registrationCount: pendingCount/);
  assert.match(notifications, /count: 'exact'/);
});

test('promotion UI and signed webhook remain connected without weakening idempotency', () => {
  assert.match(register, /api\/public\/evaluate-promotion/);
  assert.match(register, /promotionCode: state\.promotion\?\.code \|\| null/);
  assert.match(register, /promotionContextKey/);
  assert.match(register, /state\.promotionPending/);
  assert.match(webhook, /safeCompareHex\(expectedSignature, signature\)/);
  assert.match(webhook, /handle_payos_webhook/);
  assert.match(webhook, /PAYOS_WEBHOOK_DUPLICATE/);
});

test('security-definer functions use empty search path and narrow execute grants', () => {
  const definitions = sql.match(/create(?: or replace)? function[\s\S]*?\$function\$;/g) || [];
  assert.ok(definitions.length >= 7);
  for (const definition of definitions) {
    assert.match(definition, /set search_path = ''/);
  }
  assert.match(sql, /revoke all on function private\.materialize_registration_checkout_v3[\s\S]*from public, anon, authenticated, service_role/);
  assert.match(sql, /grant execute on function public\.admin_complete_awaiting_registration[\s\S]*to authenticated/);
  assert.match(sql, /create function public\.admin_list_registration_requests[\s\S]*pg_catalog\.lower\(ur\.role\) = 'admin'/);
});
