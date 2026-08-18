const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

const root = path.join(__dirname, '..');
const migrationPath = path.join(root, 'supabase/migrations/20260815120000_harden_payos_payment_intents.sql');
const periodMigrationPath = path.join(root, 'supabase/migrations/20260818120000_fix_payos_inclusive_periods_and_idempotency.sql');

test('registration has one deterministic business payment and duplicate requests are blocked', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  assert.match(sql, /registration_request_id bigint references public\.registration_requests/);
  assert.match(sql, /payments_registration_request_intent_uidx/);
  assert.match(sql, /payment_intent_key = 'registration:' \|\| new\.id::text/);
  assert.match(sql, /prevent_duplicate_pending_registration/);
  assert.match(sql, /pg_advisory_xact_lock/);
});

test('public renewal reuses one pending payment intent with a server-authoritative price', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  assert.match(sql, /intent_key text := 'public-renewal:' \|\| kiosk_id_input::text \|\| ':' \|\| months_input::text/);
  assert.match(sql, /where payment_intent_key=intent_key and payment_status='pending'/);
  assert.match(sql, /package_record\.price_per_month\*months_input/);
  const endpoint = await readFile(path.join(root, 'api/public/renew-kiosk.js'), 'utf8');
  assert.match(endpoint, /readActiveOrder\(payment\.id\)/);
  assert.match(endpoint, /Bạn đang có một mã thanh toán còn hiệu lực/);
});

test('one active PayOS order is enforced and replacement retains the business payment', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  assert.match(sql, /payos_orders_one_active_payment_uidx/);
  assert.match(sql, /status='expired',active_slot=null/);
  assert.match(sql, /superseded_by_order_id=order_record\.id/);
  assert.match(sql, /private\.reserve_crm_payos_order/);
});

test('webhook finalization approves registration and closes sibling orders transactionally', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  assert.match(sql, /from public\.payments where id=order_record\.payment_id for update/);
  assert.match(sql, /payment_record\.total_amount<>amount_input/);
  assert.match(sql, /private\.confirm_crm_payment_from_payos/);
  assert.match(sql, /update public\.registration_requests set status='approved'/);
  assert.match(sql, /update public\.payos_orders set status='cancelled',active_slot=null/);
});

test('duplicate and late old-order webhooks cannot apply service or revenue twice', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  assert.match(sql, /if event_record\.status='processed'/);
  assert.match(sql, /if payment_record\.payment_status='completed'/);
  assert.match(sql, /reconciliation_required',true/);
  assert.match(sql, /Payment already completed; paid sibling requires reconciliation/);
});

test('manual admin renewal stays PayOS-free while admin PayOS remains pending until webhook', async () => {
  const form = await readFile(path.join(root, 'src/components/RenewKioskForm.js'), 'utf8');
  const service = await readFile(path.join(root, 'src/services/PaymentService.js'), 'utf8');
  assert.match(form, /if \(values\.path === 'paid'\) await submitManual/);
  assert.match(form, /else await submitPayos/);
  assert.doesNotMatch(service.match(/async manualRenewKiosk[\s\S]*?\n  },/)?.[0] || '', /PayosService|create-payment/);
  assert.match(form, /Kiosk chỉ được gia hạn sau khi PayOS xác nhận thành công/);
});

test('checkout APIs reuse active orders and never trust return URL or polling to complete payment', async () => {
  const [registration, renewal, general, status] = await Promise.all([
    readFile(path.join(root, 'api/payos/create-registration-payment.js'), 'utf8'),
    readFile(path.join(root, 'api/public/renew-kiosk.js'), 'utf8'),
    readFile(path.join(root, 'api/payos/create-payment.js'), 'utf8'),
    readFile(path.join(root, 'api/payos/status.js'), 'utf8'),
  ]);
  for (const source of [registration, renewal, general]) assert.match(source, /active_slot/);
  for (const source of [registration, renewal, general, status]) assert.doesNotMatch(source, /payment_status\s*=\s*['"]completed/);
  assert.doesNotMatch(status, /handle_payos_webhook|confirm_crm_payment/);
});

test('PayOS finalizer owns the single inclusive calendar calculation', async () => {
  const sql = await readFile(periodMigrationPath, 'utf8');
  assert.match(sql, /drop trigger if exists normalize_payos_renewal_period_trigger/);
  assert.match(sql, /effective_start_date\+pg_catalog\.make_interval\(months=>payment_record\.months\)-interval '1 day'/);
  assert.doesNotMatch(sql, /new\.end_date\s*:=\s*new\.end_date\s*-\s*1/);
});

test('registration requested period is inclusive and synchronized to completed payment', async () => {
  const sql = await readFile(periodMigrationPath, 'utf8');
  assert.match(sql, /new\.requested_start_date\+pg_catalog\.make_interval\(months=>new\.months\)-interval '1 day'/);
  assert.match(sql, /requested_start_date=new\.start_date,requested_end_date=new\.end_date/);
  assert.match(sql, /where payment_id=new\.id/);
});

test('same paid order retry differs from late paid sibling reconciliation', async () => {
  const sql = await readFile(periodMigrationPath, 'utf8');
  assert.match(sql, /if order_record\.status='paid'[\s\S]*already_processed',true/);
  assert.match(sql, /if payment_record\.payment_status='completed'[\s\S]*reconciliation_required',true/);
  assert.ok(sql.indexOf("if order_record.status='paid'") < sql.indexOf("if payment_record.payment_status='completed'"));
});

test('public PayOS errors are sanitized and active checkout copy is friendly', async () => {
  const [registration, renewal, registerPage, lookupPage] = await Promise.all([
    readFile(path.join(root, 'api/payos/create-registration-payment.js'), 'utf8'),
    readFile(path.join(root, 'api/public/renew-kiosk.js'), 'utf8'),
    readFile(path.join(root, 'src/pages/RegisterPage.js'), 'utf8'),
    readFile(path.join(root, 'src/pages/LookupPage.js'), 'utf8'),
  ]);
  assert.match(registration, /publicRegistrationError/);
  assert.match(renewal, /publicRenewalError/);
  assert.doesNotMatch(registration, /sendError\([\s\S]{0,180}error\?\.message/);
  for (const source of [registerPage, lookupPage]) assert.match(source, /Bạn đang có một mã thanh toán còn hiệu lực/);
});

test('admin PayOS preparation reuses one pending business intent', async () => {
  const sql = await readFile(periodMigrationPath, 'utf8');
  assert.match(sql, /intent_key:='admin-renewal:'/);
  assert.match(sql, /pg_advisory_xact_lock\(pg_catalog\.hashtextextended\(intent_key,0\)\)/);
  assert.match(sql, /where payment_intent_key=intent_key and payment_status='pending'/);
  assert.match(sql, /registration_request_id is null/);
  assert.match(sql, /'reused',reused_value/);
});
