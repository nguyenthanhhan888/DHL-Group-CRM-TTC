const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = (file) => readFile(path.join(root, file), 'utf8');
const migration = 'supabase/migrations/20260819000400_fix_registration_batch_payment_consistency.sql';

test('registration batches cannot run legacy or modern single-kiosk period logic', async () => {
  const sql = await source(migration);
  assert.match(sql, /drop trigger if exists trg_payment_success on public\.payments/);
  assert.equal((sql.match(/new\.registration_batch_id is null/g) || []).length, 2);
  assert.match(sql, /sync_completed_renewal_kiosk_period/);
  assert.match(sql, /sync_registration_period_from_completed_payment/);
  assert.doesNotMatch(sql, /alter table public\.registration_batch_items|update public\.registration_batch_items/);
});

test('batch kiosk totals use item allocations while customer revenue keeps one payment', async () => {
  const [sql, revenue] = await Promise.all([
    source(migration),
    source('supabase/migrations/20260804151000_sync_revenue_from_completed_payments.sql'),
  ]);
  assert.match(sql, /select\s+i\.total_amount as amount/);
  assert.match(sql, /where i\.kiosk_id = kiosk_id_input/);
  assert.match(sql, /p\.registration_batch_id = b\.id/);
  assert.match(sql, /total_paid = totals\.amount/);
  assert.match(sql, /kiosk_total_paid = totals\.amount/);
  assert.match(revenue, /select sum\(p\.total_amount\)[\s\S]*where p\.customer_id = customer_id_input/);
  assert.doesNotMatch(sql, /recalculate_customer_payment_total\(.*kiosk/i);

  const paymentTotal = 4000;
  const allocations = [2000, 2000];
  assert.equal(allocations.reduce((sum, amount) => sum + amount, 0), paymentTotal);
  assert.deepEqual(allocations, [2000, 2000]);
});

test('ordinary payments and renewals retain single-kiosk totals and dates', async () => {
  const sql = await source(migration);
  assert.match(sql, /p\.registration_batch_id is null[\s\S]*p\.kiosk_id = kiosk_id_input/);
  assert.match(sql, /elsif new\.kiosk_id is not null then[\s\S]*recalculate_kiosk_payment_total\(new\.kiosk_id\)/);
  assert.match(sql, /new\.registration_batch_id is null[\s\S]*update public\.kiosks[\s\S]*start_date = new\.start_date/);
});

test('batch finalizer remains sole owner of every kiosk and item date', async () => {
  const batch = await source('supabase/migrations/20260818235900_create_public_registration_batches.sql');
  const sql = await source(migration);
  assert.match(batch, /update public\.registration_batch_items set start_date=confirmation_date,end_date=calculated_end/);
  assert.match(batch, /update public\.kiosks set status='active',start_date=confirmation_date,end_date=calculated_end/);
  assert.doesNotMatch(sql, /registration_batch_id is not null[\s\S]{0,200}start_date\s*=\s*new\.start_date/i);
});

test('registration lookup navigation clears PayOS return state and can prefill phone', async () => {
  const page = await source('src/pages/RegisterPage.js');
  assert.match(page, /phone: read\('register-phone'\)/);
  assert.match(page, /data-registration-lookup/);
  assert.match(page, /sessionStorage\.setItem\('lookup-prefill-phone', phone\)/);
  assert.match(page, /history\.replaceState\(\{\}, '', `\$\{window\.location\.pathname\}#\/lookup`\)/);
  assert.match(page, /renderSuccess\(status, stored\.phone\)/);
});

test('only a stored public-renewal flow can activate renewal return mode', async () => {
  const page = await source('src/pages/LookupPage.js');
  const guard = page.indexOf("readStoredPayosState(`renewal-payos:${orderCode}`)");
  const hide = page.indexOf("getElementById('lookup-form')?.classList.add('hidden')");
  const poll = page.indexOf('PublicLookupService.renewalStatus');
  assert.ok(guard > 0 && hide > guard && poll > hide);
  assert.match(page, /!stored\.renewalToken \|\| String\(stored\.orderCode\) !== String\(orderCode\)/);
  assert.match(page, /clearPayosReturnParams\(\);[\s\S]*return false/);
  assert.match(page, /sessionStorage\.getItem\('lookup-prefill-phone'\)/);
  assert.match(page, /attempt < 10/);
});
