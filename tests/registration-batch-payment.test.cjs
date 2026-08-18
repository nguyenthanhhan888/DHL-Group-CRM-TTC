const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const migrationPath = path.join(root, 'supabase/migrations/20260818235900_create_public_registration_batches.sql');
const source = (file) => readFile(path.join(root, file), 'utf8');

test('single and multi-Kiosk registration use the same one-batch one-payment architecture', async () => {
  const [sql, api] = await Promise.all([readFile(migrationPath, 'utf8'), source('api/payos/create-registration-payment.js')]);
  assert.match(sql, /create table if not exists public\.registration_batches/);
  assert.match(sql, /create table if not exists public\.registration_batch_items/);
  assert.match(sql, /request_count<1 or request_count>20/);
  assert.match(sql, /insert into public\.payments[\s\S]*registration_batch_id[\s\S]*values\(/);
  assert.match(sql, /payments_registration_batch_uidx/);
  assert.match(sql, /registration_batches_payment_uidx/);
  assert.match(api, /prepare_registration_batch_for_payos/);
  assert.doesNotMatch(api, /for\s*\(const requestId|prepare_registration_payment_for_payos|payments\s*:/);
});

test('batch total is a server-side sum of current active business-type prices', async () => {
  const [sql, api] = await Promise.all([readFile(migrationPath, 'utf8'), source('api/payos/create-registration-payment.js')]);
  assert.match(sql, /business_types where id=request_record\.business_type_id and is_active=true/);
  assert.match(sql, /request_record\.discount,0\)<>0/);
  assert.match(sql, /item_total:=package_record\.price_per_month\*request_record\.months/);
  assert.match(sql, /request_record\.total_amount is distinct from item_total/);
  assert.match(sql, /authoritative_total:=authoritative_total\+item_total/);
  assert.match(sql, /payment_record\.total_amount<>batch_record\.total_amount/);
  assert.doesNotMatch(api, /parsed\.value\.(amount|total|price)/);
});

test('repeated checkout and expired replacement retain one underlying batch payment', async () => {
  const [sql, api] = await Promise.all([readFile(migrationPath, 'utf8'), source('api/payos/create-registration-payment.js')]);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /return jsonb_build_object\('batch'.*'reused',true\)/s);
  assert.match(api, /fetchExistingPayosOrder\(payment\.id\)/);
  assert.match(api, /status: 'eq\.pending'/);
  assert.match(api, /recordOrder\(payment\.id/);
  const hardening = await source('supabase/migrations/20260815120000_harden_payos_payment_intents.sql');
  assert.match(hardening, /payos_orders_one_active_payment_uidx/);
  assert.match(hardening, /status='expired',active_slot=null/);
});

test('paid webhook transactionally activates every batch item exactly once', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  assert.match(sql, /private\.confirm_registration_batch_from_payos/);
  assert.match(sql, /for update of i,k,r/);
  assert.match(sql, /for item_record in select i\.\*,k\.facebook_name/);
  assert.match(sql, /update public\.kiosks set status='active'/);
  assert.match(sql, /update public\.registration_requests set status='approved'/);
  assert.match(sql, /if item_count<1 then raise exception/);
  assert.match(sql, /payment_record\.registration_batch_id is not null then rpc_result:=private\.confirm_registration_batch_from_payos/);
  assert.match(sql, /if event_record\.status='processed' then return jsonb_build_object\('already_processed',true/);
  assert.match(sql, /if payment_record\.payment_status='completed'/);
});

test('batch dates are inclusive per item and revenue is represented by one completed payment', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  assert.match(sql, /confirmation_date\+pg_catalog\.make_interval\(months=>item_record\.months\)-interval '1 day'/);
  assert.match(sql, /update public\.payments set payment_status='completed'/);
  assert.equal((sql.match(/insert into public\.payments/g) || []).length, 1);
  assert.match(sql, /total_amount=authoritative_total/);
});

test('batch status is read-only and returns all activated Kiosks', async () => {
  const [status, page] = await Promise.all([source('api/payos/status.js'), source('src/pages/RegisterPage.js')]);
  assert.match(status, /registration_batch_items/);
  assert.match(status, /kiosks: items\.map/);
  assert.doesNotMatch(status, /handle_payos_webhook|confirm_registration_batch|update\s+public\./i);
  assert.match(page, /\(data\?\.kiosks \|\| \[\]\)\.map/);
  assert.match(page, /Kiosk đã kích hoạt/);
  assert.doesNotMatch(page, /payosPayments\?\.\[0\]|checkoutUrls?\[0\]/);
});

test('new batch RPCs are locked down and legacy, renewal, and admin paths remain available', async () => {
  const [sql, renewal, admin] = await Promise.all([readFile(migrationPath, 'utf8'), source('api/public/renew-kiosk.js'), source('src/components/RenewKioskForm.js')]);
  assert.match(sql, /security definer set search_path=''/g);
  assert.match(sql, /revoke all on function public\.prepare_registration_batch_for_payos\(bigint\[\],text\) from public,anon,authenticated/);
  assert.match(sql, /grant execute on function public\.prepare_registration_batch_for_payos\(bigint\[\],text\) to service_role/);
  assert.match(sql, /Historical request,[\s\S]*remain unchanged/);
  assert.match(renewal, /prepare_public_kiosk_renewal/);
  assert.match(admin, /if \(values\.path === 'paid'\) await submitManual/);
  assert.match(admin, /else await submitPayos/);
});
