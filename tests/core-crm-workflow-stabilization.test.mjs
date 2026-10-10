import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { countActionableRegistrations, isBusinessRegistration, registrationFollowup } from '../src/utils/registrationFollowup.js';
import { canAccessRoute } from '../src/constants/permissions.js';
import { createPermissionQaDatabase, asQaUser } from './fixtures/permission-qa-database.mjs';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const linked = { customer_id: 1, kiosk_id: 2, payment_id: 3, total_amount: 100000 };

test('public technical drafts stay hidden until a PayOS checkout artifact exists', () => {
  const draft = { id: 1, status: 'awaiting_payment', payment_status: 'pending', metadata: { workflow: 'public_payos' }, registration_batch_id: 8, ...linked };
  assert.equal(isBusinessRegistration(draft), false);
  assert.deepEqual(registrationFollowup(draft), { actionable: false, actions: 'none', bucket: 'hidden' });
  for (const evidence of [{ payos_checkout_created: true }, { payos_has_checkout_url: true }, { payos_state: 'awaiting_customer' }]) {
    const request = { ...draft, ...evidence };
    assert.equal(isBusinessRegistration(request), true);
    assert.equal(registrationFollowup(request).bucket, 'awaiting-payment');
    assert.equal(registrationFollowup(request).actionable, false);
  }
});

test('unpaid PayOS volume never becomes a sidebar task count', () => {
  const rows = Array.from({ length: 100 }, (_, index) => ({ id: index + 1, status: 'awaiting_payment', payment_status: 'pending',
    metadata: { workflow: 'public_payos' }, registration_batch_id: index + 1, payos_checkout_created: true, ...linked }));
  assert.equal(countActionableRegistrations(rows), 0);
  assert.ok(rows.every(row => registrationFollowup(row).bucket === 'awaiting-payment'));
});

test('manual, Legacy and Additional review count once; materialized anomalies explain why', () => {
  for (const row of [
    { id: 1, status: 'pending' },
    { id: 2, status: 'pending', metadata: { request_type: 'legacy' } },
    { id: 3, status: 'pending', metadata: { request_type: 'additional' } },
  ]) assert.equal(registrationFollowup(row).bucket, 'needs-action');
  const anomaly = { id: 4, status: 'approved', metadata: { source: 'additional' }, customer_id: 1, kiosk_id: null, payment_id: 3, total_amount: 100000 };
  assert.deepEqual(registrationFollowup(anomaly).reasons, ['Thiếu liên kết Kiosk']);
  assert.equal(countActionableRegistrations([anomaly, { ...anomaly, id: '4' }]), 1);
  assert.deepEqual(registrationFollowup({ id: 5, status: 'awaiting_payment', payment_status: 'pending', payos_order_status: 'paid', ...linked }).reasons,
    ['PayOS đã thanh toán nhưng Thanh toán CRM còn chờ']);
});

test('completed and closed registrations have terminal business buckets without badge work', () => {
  const completed = { id: 1, status: 'approved', payment_status: 'completed', ...linked };
  for (const row of [completed, { id: 2, status: 'cancelled' }, { id: 3, status: 'rejected' }]) {
    assert.equal(registrationFollowup(row).actionable, false);
  }
  assert.equal(registrationFollowup(completed).bucket, 'completed');
  assert.equal(registrationFollowup({ id: 2, status: 'cancelled' }).bucket, 'closed');
});

test('CRM navigation exposes Payments through the existing payments permission', async () => {
  const navigation = await read('src/constants/navigation.js');
  const crm = navigation.slice(navigation.indexOf("label: 'QUẢN LÝ CRM'"), navigation.indexOf("label: 'HỆ THỐNG'"));
  assert.match(crm, /route: 'payments', label: 'Thanh toán'/);
  assert.equal(canAccessRoute({ status: 'active', web_access_enabled: true, permissions: ['payments'] }, 'payments'), true);
  assert.equal(canAccessRoute({ status: 'active', web_access_enabled: true, permissions: [] }, 'payments'), false);
});

test('ordinary pending Payment actions omit rejection while historical rejected remains renderable', async () => {
  const page = await read('src/pages/PaymentsPage.js');
  const actions = page.slice(page.indexOf('function renderApprovalAction'), page.indexOf('function openPaymentPayos'));
  assert.match(actions, /Tạo\/Mở PayOS/);
  assert.match(actions, /Xác nhận thủ công/);
  assert.match(actions, />Sửa</);
  assert.match(actions, />Hủy</);
  assert.doesNotMatch(actions, /data-payment-action="reject"|>Từ chối</);
  assert.match(actions, /status === 'rejected'[\s\S]*Đã từ chối/);
});

test('Reports uses the approved reconciliation name and definition', async () => {
  const reports = await read('src/pages/ReportsPage.js');
  assert.match(reports, /id: 'reconciliation', label: 'Đối soát dữ liệu'/);
  assert.match(reports, /Phát hiện các bản ghi có dữ liệu thiếu, không khớp hoặc trạng thái mâu thuẫn giữa Hồ sơ Kiosk, Kiosk, Thanh toán và PayOS\./);
  assert.doesNotMatch(reports, /Đánh dấu đã xử lý/);
});

test('PayOS retry keeps one logical Payment and expiry never closes Registration or Payment', async () => {
  const [api, lifecycle, checkout] = await Promise.all([
    read('api/payos/create-payment.js'),
    read('api/payos/_lifecycle.js'),
    read('supabase/migrations/20260929170839_finalize_crm_registration_checkout.sql'),
  ]);
  assert.match(api, /prepareCheckoutRetry\(payload\.paymentId\)/);
  assert.match(api, /payment_id_input: payload\.paymentId/);
  assert.doesNotMatch(api, /insert into public\.payments/i);
  assert.doesNotMatch(lifecycle, /payment-requests\/.*cancel|method:\s*['"]POST['"]/);
  const expiry = checkout.slice(checkout.indexOf('create or replace function private.expire_crm_checkout_slots'), checkout.indexOf('revoke all on function private.expire_crm_checkout_slots'));
  assert.match(expiry, /update public\.payos_orders set status='expired',active_slot=null/);
  assert.doesNotMatch(expiry, /update public\.(payments|registration_requests)/);
});

test('existing PAID and external completion workflows still activate Kiosks', async () => {
  const [batch, checkout] = await Promise.all([
    read('supabase/migrations/20260818235900_create_public_registration_batches.sql'),
    read('supabase/migrations/20260825160000_complete_registration_checkout_v3.sql'),
  ]);
  assert.match(batch, /private\.confirm_registration_batch_from_payos/);
  assert.match(`${batch}\n${checkout}`, /update public\.kiosks[\s\S]*status = 'active'/);
  assert.match(checkout, /create function public\.admin_complete_awaiting_registration/);
  assert.match(checkout, /payment_method = 'external'/);
  assert.match(checkout, /payment_status = 'completed'/);
});

test('forward migration fixes direct-Kiosk reconciliation and preserves true missing detection', async () => {
  const db = await createPermissionQaDatabase();
  try {
    const migration = await read('supabase/migrations/20261010125844_stabilize_registration_payment_reconciliation.sql');
    await db.exec(migration);
    const listDefinition = await db.query("select pg_get_functiondef('public.admin_list_registration_requests(text)'::regprocedure) definition");
    assert.match(listDefinition.rows[0].definition, /payos_checkout_created/);
    assert.match(listDefinition.rows[0].definition, /from public\.payos_orders checkout_order[\s\S]*checkout_order\.qr_code/);
    await db.exec(`
      insert into public.kiosks(id,customer_id,facebook_name,facebook_id,business_type_id,category_id,status)
      values(2,1,'Kiosk chưa kích hoạt','9999990002',1,1,'pending');
      insert into public.payments(id,customer_id,kiosk_id,price_per_month,total_amount,payment_status)
      values
        (365,1,2,100000,100000,'pending'),
        (366,1,null,100000,100000,'pending'),
        (367,1,1,100000,100000,'pending');
    `);
    const result = await asQaUser(db, 'admin', "select public.get_reports_data_filtered(p_report_type=>'reconciliation',p_page_size=>100) data");
    const rows = result.rows[0].data.rows;
    const missingKiosk = rows.filter(row => row.issueCode === 'payment_without_kiosk');
    assert.equal(missingKiosk.some(row => String(row.paymentId) === '365'), false);
    assert.equal(missingKiosk.some(row => String(row.paymentId) === '366'), true);
    assert.equal(rows.some(row => String(row.paymentId) === '367'), false);
  } finally {
    await db.close();
  }
});
