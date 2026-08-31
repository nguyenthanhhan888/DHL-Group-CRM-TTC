import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  historicalPaymentErrorMessage,
  validateHistoricalPaymentCorrection,
} from '../src/components/HistoricalPaymentEditForm.js';
import { formatAuditLog } from '../src/utils/auditLogPresentation.js';

const migrationUrl = new URL(
  '../supabase/migrations/20260831120000_create_historical_payment_correction.sql',
  import.meta.url,
);

async function sources() {
  const [sql, service, page, router, app, css] = await Promise.all([
    readFile(migrationUrl, 'utf8'),
    readFile(new URL('../src/services/PaymentService.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/KioskDetailPage.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/router/index.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/styles/app.css', import.meta.url), 'utf8'),
  ]);
  return { sql, service, page, router, app, css };
}

test('case 450k/30-08 to 950k/30-12 is submitted as one in-place RPC correction', async () => {
  const { sql, service } = await sources();
  assert.match(service, /rpc\('correct_historical_payment'/);
  assert.match(service, /start_date_input:\s*requiredText\(startDate/);
  assert.match(service, /end_date_input:\s*requiredText\(endDate/);
  assert.match(service, /total_amount_input:\s*amount/);
  assert.match(sql, /update public\.payments\s+set start_date = start_date_input,[\s\S]*total_amount = total_amount_input[\s\S]*where id = before_payment\.id/);
  assert.doesNotMatch(sql, /insert into public\.payments/i);
  assert.doesNotMatch(sql, /delete from public\.payments/i);
});

test('RPC is System Admin-only and rejects locked/web-disabled users through canonical access', async () => {
  const { sql } = await sources();
  assert.match(sql, /if not public\.is_system_admin\(\) then[\s\S]*errcode = '42501'/);
  assert.match(sql, /status = 'active'[\s\S]*web_access_enabled[\s\S]*is_system_admin/);
  assert.match(sql, /revoke all on function public\.correct_historical_payment[\s\S]*from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.correct_historical_payment[\s\S]*to authenticated/);
  assert.doesNotMatch(sql, /assert_payment_permission|user_roles/);
});

test('RPC validates completed status, reason, amount, dates, months, and related records', async () => {
  const { sql } = await sources();
  assert.match(sql, /payment_status[\s\S]*<> 'completed'[\s\S]*confirmed_at is null/);
  assert.match(sql, /transaction_type[\s\S]*= 'adjustment'/);
  assert.match(sql, /registration_batch_id is not null/);
  assert.match(sql, /total_amount_input is null or total_amount_input <= 0/);
  assert.match(sql, /end_date_input < start_date_input/);
  assert.match(sql, /months_input is null or months_input < 1/);
  assert.match(sql, /normalized_reason = ''/);
  assert.match(sql, /from public\.kiosks[\s\S]*for update/);
  assert.match(sql, /from public\.customers[\s\S]*for update/);
});

test('newer completed payment or batch period cannot be shortened by correcting an older payment', async () => {
  const { sql } = await sources();
  assert.match(sql, /select pg_catalog\.max\(period_end\) into authoritative_end_date/);
  assert.match(sql, /from public\.payments p[\s\S]*p\.kiosk_id = before_payment\.kiosk_id/);
  assert.match(sql, /from public\.registration_batch_items i[\s\S]*i\.kiosk_id = before_payment\.kiosk_id/);
  assert.match(sql, /when authoritative_end_date > k\.end_date then authoritative_end_date/);
  assert.match(sql, /when k\.end_date is not distinct from before_payment\.end_date then authoritative_end_date/);
});

test('payment totals and audit remain in the same database transaction', async () => {
  const { sql } = await sources();
  assert.match(sql, /from public\.payments\s+where id = payment_id_input\s+for update/);
  assert.match(sql, /set_config\('app\.payment_workflow_action', 'historical_correction', true\)/);
  assert.match(sql, /insert into public\.audit_logs/);
  assert.match(sql, /'correction_type', 'historical_payment'/);
  assert.match(sql, /'start_date', before_payment\.start_date/);
  assert.match(sql, /'total_amount', after_payment\.total_amount/);
  assert.match(sql, /normalized_reason/);
  assert.match(sql, /sync_completed_renewal_kiosk_period[\s\S]*historical_correction[\s\S]*return null/);
});

test('historical workflow guard permits only the four audited fields', async () => {
  const { sql } = await sources();
  assert.match(sql, /to_jsonb\(new\)[\s\S]*array\['start_date', 'end_date', 'months', 'total_amount'\]/);
  assert.match(sql, /to_jsonb\(old\)[\s\S]*array\['start_date', 'end_date', 'months', 'total_amount'\]/);
  assert.doesNotMatch(sql, /update public\.payos_orders|update public\.registration_requests|update public\.registration_batches/i);
  assert.doesNotMatch(sql, /handle_payos_webhook|confirm_crm_payment_from_payos|create_renewal_payment/i);
  assert.doesNotMatch(sql, /pg_catalog\.(?:coalesce|trim|nullif|greatest|least|extract|current_date|current_timestamp)\b/i);
});

test('frontend resolves System Admin authoritatively and renders a visible payment action', async () => {
  const { page, router, app, service, css } = await sources();
  assert.match(app, /context:\s*\{ profile \}/);
  assert.match(router, /page\.afterRender\?\.\(\{ \.\.\.context, route, params, outlet \}\)/);
  assert.match(service, /canCorrectHistorical[\s\S]*rpc\('is_system_admin'\)/);
  assert.match(page, /PaymentService\.canCorrectHistorical\(\)/);
  assert.match(page, /detailState\.canCorrectHistorical === true/);
  assert.match(page, /isSystemAdmin\(\) \? '<th>Thao tác<\/th>' : ''/);
  assert.match(page, /data-edit-historical-payment/);
  assert.match(page, />Sửa dữ liệu thanh toán<\/button>/);
  assert.match(page, /data-label="Loại giao dịch"/);
  assert.match(page, /payment_status[\s\S]*completed[\s\S]*transaction_type[\s\S]*adjustment/);
  assert.doesNotMatch(page, /Boolean\(payment\.confirmed_at\)/);
  assert.match(css, /kiosk-payment-history-table\.has-admin-actions th:last-child[\s\S]*position:sticky/);
  assert.match(css, /@media\(max-width:760px\)[\s\S]*kiosk-payment-history-table[\s\S]*display:block[\s\S]*kiosk-payment-edit-action\{width:100%/);
});

test('missing migration is surfaced as a clear form error instead of failing silently', () => {
  assert.equal(
    historicalPaymentErrorMessage({ message: 'Could not find the function public.correct_historical_payment in the schema cache' }),
    'Chức năng sửa dữ liệu thanh toán chưa được cài đặt trên database. Vui lòng apply migration trước khi sử dụng.',
  );
  assert.equal(historicalPaymentErrorMessage({ message: 'Reason rejected' }), 'Reason rejected');
});

test('payment editor keeps the requested field order and remains separate from Kiosk/customer forms', async () => {
  const form = await readFile(new URL('../src/components/HistoricalPaymentEditForm.js', import.meta.url), 'utf8');
  const positions = [
    'historical-payment-start-date',
    'historical-payment-end-date',
    'historical-payment-months',
    'historical-payment-amount',
    'historical-payment-reason',
  ].map((id) => form.indexOf(`id="${id}"`));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  assert.doesNotMatch(form, /KioskEditForm|CustomerEditForm/);
});

test('client validation rejects empty reason and invalid historical values', () => {
  const base = {
    startDate: '2026-06-01', endDate: '2026-12-30', months: 7,
    totalAmount: 950000, reason: 'Đã đối chiếu dữ liệu import cũ.',
  };
  assert.equal(validateHistoricalPaymentCorrection(base), '');
  assert.equal(validateHistoricalPaymentCorrection({ ...base, reason: '  ' }), 'Lý do chỉnh sửa là bắt buộc.');
  assert.equal(validateHistoricalPaymentCorrection({ ...base, endDate: '2026-05-31' }), 'Ngày kết thúc không được trước ngày bắt đầu.');
  assert.equal(validateHistoricalPaymentCorrection({ ...base, startDate: '2026-02-31' }), 'Ngày bắt đầu và ngày kết thúc là bắt buộc.');
  assert.equal(validateHistoricalPaymentCorrection({ ...base, totalAmount: 0 }), 'Số tiền phải lớn hơn 0.');
  assert.equal(validateHistoricalPaymentCorrection({ ...base, months: 0 }), 'Số tháng phải là số nguyên lớn hơn 0.');
});

test('audit presentation is business-readable and remains visible with technical mode off', () => {
  const log = formatAuditLog({
    module: 'Payment', entity: 'payments', action: 'update', record_id: '42',
    actor_name: 'Nguyễn Thanh Hân', actor_type: 'staff', reason: 'Dữ liệu import cũ bị nhập sai.',
    resolved_entity: { kind: 'Kiosk', name: 'ABC', id: 9 },
    before: {
      correction_type: 'historical_payment', payment_id: 42, kiosk_id: 9,
      start_date: '2026-06-01', end_date: '2026-08-30', months: 3, total_amount: 450000,
    },
    after: {
      correction_type: 'historical_payment', payment_id: 42, kiosk_id: 9,
      start_date: '2026-06-01', end_date: '2026-12-30', months: 7, total_amount: 950000,
    },
  });
  assert.equal(log.actionLabel, 'Sửa dữ liệu thanh toán');
  assert.equal(log.title, 'Nguyễn Thanh Hân đã sửa dữ liệu thanh toán của Kiosk ABC');
  assert.match(log.secondary, /450\.000 VNĐ → 950\.000 VNĐ/);
  assert.match(log.secondary, /30\/08\/2026 → 30\/12\/2026/);
  assert.match(log.secondary, /Lý do: Dữ liệu import cũ bị nhập sai\./);
  assert.equal(log.technical, false);
});
