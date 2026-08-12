const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

const root = path.join(__dirname, '..');
const migrationPath = path.join(root, 'supabase/migrations/20260811232853_fix_prepare_public_kiosk_renewal_service_role_authorization.sql');
const migration = () => readFile(migrationPath, 'utf8');

test('legitimate service_role claim passes prepare renewal role guard', async () => {
  const sql = await migration();
  assert.match(sql, /coalesce\(auth\.jwt\(\)\s*->>\s*'role',\s*''\)\s*<>\s*'service_role'/i);
  assert.doesNotMatch(sql, /request\.jwt\.claim\.role/i);
});

test('prepare renewal remains executable only by service_role', async () => {
  const sql = await migration();
  assert.match(sql, /revoke all on function public\.prepare_public_kiosk_renewal\(bigint, integer, text\)[\s\S]*from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.prepare_public_kiosk_renewal\(bigint, integer, text\)[\s\S]*to service_role/i);
  assert.doesNotMatch(sql, /grant execute[\s\S]*to (?:anon|authenticated)/i);
});

test('renewal authorization is consumed exactly once before payment creation', async () => {
  const sql = await migration();
  assert.match(sql, /update private\.public_renewal_authorizations[\s\S]*consumed_at\s*=\s*now\(\)[\s\S]*consumed_at is null[\s\S]*expires_at\s*>\s*now\(\)/i);
  assert.match(sql, /if not found then[\s\S]*Quyền gia hạn đã hết hạn hoặc đã được sử dụng/i);
  assert.ok(sql.indexOf('update private.public_renewal_authorizations') < sql.indexOf('insert into public.payments'));
});

test('price remains server authoritative and invalid prices are rejected', async () => {
  const sql = await migration();
  assert.match(sql, /from public\.business_types[\s\S]*id\s*=\s*kiosk_record\.business_type_id[\s\S]*is_active\s*=\s*true/i);
  assert.match(sql, /package_record\.price_per_month is null[\s\S]*package_record\.price_per_month <= 0/i);
  assert.match(sql, /package_record\.price_per_month \* months_input/i);
  assert.doesNotMatch(sql, /price_per_month_input|total_amount_input/i);
});

test('valid preparation creates the expected pending transfer payment and JSON contract', async () => {
  const sql = await migration();
  assert.match(sql, /months_input not in \(1, 3, 6, 12\)/i);
  assert.match(sql, /insert into public\.payments/i);
  assert.match(sql, /'transfer',\s*'pending',\s*'Public PayOS Kiosk renewal',\s*'standard'/i);
  assert.match(sql, /jsonb_build_object\([\s\S]*'payment'[\s\S]*'kiosk_name'[\s\S]*'business_type'/i);
});

test('prepare renewal errors do not log service credentials or secrets', async () => {
  const source = await readFile(path.join(root, 'api/public/renew-kiosk.js'), 'utf8');
  assert.doesNotMatch(source, /console\.(?:log|error)\([^)]*(?:SUPABASE_SERVICE|PUBLIC_RENEWAL_TOKEN_SECRET|renewalToken)/i);
  assert.doesNotMatch(source, /process\.env\.SUPABASE_(?:SERVICE_ROLE_KEY|SERVICE_KEY)/);
});
