const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile, readdir } = require('node:fs/promises');
const path = require('node:path');

const root = path.join(__dirname, '..');
const migrationsDir = path.join(root, 'supabase/migrations');
const migrationName = '20260811234908_fix_record_public_renewal_payos_order_service_role_authorization.sql';
const migration = () => readFile(path.join(migrationsDir, migrationName), 'utf8');

test('legitimate service_role claim passes PayOS order recording guard', async () => {
  const sql = await migration();
  assert.match(sql, /coalesce\(auth\.jwt\(\)\s*->>\s*'role',\s*''\)\s*<>\s*'service_role'/i);
  assert.doesNotMatch(sql, /request\.jwt\.claim\.role/i);
});

test('PayOS order recording remains executable only by service_role', async () => {
  const sql = await migration();
  assert.match(sql, /revoke all on function public\.record_public_renewal_payos_order\([\s\S]*?\) from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.record_public_renewal_payos_order\([\s\S]*?\) to service_role/i);
  assert.doesNotMatch(sql, /grant execute[\s\S]*to (?:anon|authenticated)/i);
});

test('only pending public renewal payment can be recorded', async () => {
  const sql = await migration();
  assert.match(sql, /from public\.payments[\s\S]*id\s*=\s*payment_id_input[\s\S]*payment_status\s*=\s*'pending'[\s\S]*note\s*=\s*'Public PayOS Kiosk renewal'/i);
});

test('wrong amount and non-public-renewal payment are rejected', async () => {
  const sql = await migration();
  assert.match(sql, /if not found or payment_record\.total_amount\s*<>\s*amount_input then[\s\S]*Thanh toán gia hạn không hợp lệ/i);
  assert.doesNotMatch(sql, /total_amount_input|price_per_month_input/i);
});

test('PayOS record preserves provider fields, pending upsert, and JSON response', async () => {
  const sql = await migration();
  assert.match(sql, /insert into public\.payos_orders/i);
  assert.match(sql, /'crm_payment'/i);
  for (const field of ['checkout_url', 'qr_code', 'payment_link_id', 'provider_payload']) assert.match(sql, new RegExp(field));
  assert.match(sql, /on conflict \(order_code\) do update[\s\S]*public\.payos_orders\.status\s*=\s*'pending'/i);
  assert.match(sql, /return to_jsonb\(order_record\)/i);
});

test('recording path does not log service credentials or renewal secrets', async () => {
  const source = await readFile(path.join(root, 'api/public/renew-kiosk.js'), 'utf8');
  assert.doesNotMatch(source, /console\.(?:log|error)\([^)]*(?:SUPABASE_SERVICE|PUBLIC_RENEWAL_TOKEN_SECRET|renewalToken)/i);
  assert.doesNotMatch(source, /process\.env\.SUPABASE_(?:SERVICE_ROLE_KEY|SERVICE_KEY)/);
});

test('latest application-owned public renewal RPC definitions use no legacy singular role setting', async () => {
  const names = [
    'register_public_renewal_authorization',
    'prepare_public_kiosk_renewal',
    'record_public_renewal_payos_order',
  ];
  const files = (await readdir(migrationsDir)).filter((name) => name.endsWith('.sql')).sort();
  for (const functionName of names) {
    let latest = '';
    for (const file of files) {
      const sql = await readFile(path.join(migrationsDir, file), 'utf8');
      if (new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${functionName}\\s*\\(`, 'i').test(sql)) latest = sql;
    }
    assert.ok(latest, `Missing definition for ${functionName}`);
    assert.doesNotMatch(latest, /request\.jwt\.claim\.role/i, functionName);
    assert.match(latest, /auth\.jwt\(\)\s*->>\s*'role'/i, functionName);
  }
});
