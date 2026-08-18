const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = (file) => readFile(path.join(root, file), 'utf8');

test('reproduces SQLSTATE 42883 source and hotfixes every affected batch function', async () => {
  const [applied, hotfix] = await Promise.all([
    source('supabase/migrations/20260818235900_create_public_registration_batches.sql'),
    source('supabase/migrations/20260819000100_fix_registration_batch_pg_catalog_coalesce.sql'),
  ]);

  // This is the first runtime initializer in prepare_registration_batch_for_payos.
  assert.match(applied, /normalized_phone text:=pg_catalog\.regexp_replace\(pg_catalog\.coalesce\(phone_input,''\)/);
  assert.match(hotfix, /'pg_catalog\.coalesce\('/);
  assert.match(hotfix, /'coalesce\('/);

  for (const signature of [
    'public.prepare_registration_batch_for_payos(bigint[],text)',
    'private.confirm_registration_batch_from_payos(bigint,text)',
    'public.record_registration_payos_order(bigint,bigint,numeric,text,text,text,text,jsonb)',
    'public.handle_payos_webhook(bigint,numeric,text,text,jsonb,text,text)',
  ]) {
    assert.ok(hotfix.includes(`'${signature}'::regprocedure`), `missing hotfix target ${signature}`);
  }
  assert.match(hotfix, /pg_get_functiondef\(target\)/);
  assert.match(hotfix, /execute corrected_definition/);
  assert.doesNotMatch(hotfix, /drop table|delete from|truncate/i);
});

test('registration API preserves safe PostgreSQL code, message, details, and hint diagnostics', async () => {
  const api = await source('api/payos/create-registration-payment.js');
  assert.match(api, /error\.details = data\?\.details/);
  assert.match(api, /error\.hint = data\?\.hint/);
  for (const field of ['code', 'message', 'details', 'hint']) {
    assert.match(api, new RegExp(`${field}: safeDiagnostic\\(error\\?\\.${field}\\)`));
  }
  assert.match(api, /REDACTED_JWT/);
  assert.match(api, /REDACTED_NUMBER/);
  assert.doesNotMatch(api.match(/console\.error\('REGISTRATION_BATCH_PAYOS_FAILED'[\s\S]*?\);/)?.[0] || '', /PAYOS_API_KEY|SERVICE_ROLE|CHECKSUM|authorization/i);
});

test('failure remains before every PayOS network request and batch ownership is unchanged', async () => {
  const api = await source('api/payos/create-registration-payment.js');
  assert.ok(api.indexOf('await prepareBatch(requestIds, phone)') < api.indexOf('await fetch(`${PAYOS_API_BASE_URL'));
  assert.match(api, /prepare_registration_batch_for_payos/);
  assert.match(api, /recordOrder\(payment\.id/);
  assert.doesNotMatch(api, /prepare_registration_payment_for_payos|for\s*\(const requestId/);
});
