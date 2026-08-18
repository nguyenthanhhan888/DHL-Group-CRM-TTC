const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = (file) => readFile(path.join(root, file), 'utf8');

test('production schema contract does not define registration_requests.updated_at', async () => {
  const [schemaDecision, service] = await Promise.all([
    source('docs/decisions/DATABASE.md'),
    source('src/services/RegistrationRequestService.js'),
  ]);
  const section = schemaDecision.match(/### `registration_requests`[\s\S]*?(?=\n## |\n### )/)?.[0] || '';
  assert.match(section, /`submitted_at`, `reviewed_at`/);
  assert.doesNotMatch(section, /`updated_at`/);
  assert.doesNotMatch(service, /updated_at/);
});

test('webhook column hotfix repairs every effective registration request writer', async () => {
  const hotfix = await source('supabase/migrations/20260819000300_fix_registration_request_webhook_columns.sql');
  for (const signature of [
    'private.confirm_registration_batch_from_payos(bigint,text)',
    'private.sync_registration_period_from_completed_payment()',
    'public.handle_payos_webhook(bigint,numeric,text,text,jsonb,text,text)',
  ]) {
    assert.ok(hotfix.includes(`'${signature}'::regprocedure`), `missing column hotfix target ${signature}`);
  }
  assert.match(hotfix, /pg_get_functiondef\(target\)/);
  assert.match(hotfix, /execute corrected_definition/g);
  assert.doesNotMatch(hotfix, /alter\s+table\s+public\.registration_requests\s+add/i);
  assert.doesNotMatch(hotfix, /drop\s+(function|trigger|table)|delete\s+from|truncate/i);
});

test('all historical registration_requests.updated_at writes are classified', async () => {
  const files = [
    'supabase/migrations/20260815120000_harden_payos_payment_intents.sql',
    'supabase/migrations/20260818120000_fix_payos_inclusive_periods_and_idempotency.sql',
    'supabase/migrations/20260818235900_create_public_registration_batches.sql',
  ];
  const matches = [];
  for (const file of files) {
    const sql = await source(file);
    for (const match of sql.matchAll(/update public\.registration_requests set[^;]*updated_at\s*=/gi)) {
      matches.push({ file, statement: match[0] });
    }
  }
  assert.equal(matches.length, 5);
  assert.equal(matches.filter(({ file }) => file.includes('20260815120000')).length, 1);
  assert.equal(matches.filter(({ file }) => file.includes('20260818120000')).length, 2);
  assert.equal(matches.filter(({ file }) => file.includes('20260818235900')).length, 2);
});

test('reachable table-column references remain covered by their schema contracts', async () => {
  const [foundation, batches, hardening, finalizer] = await Promise.all([
    source('supabase/migrations/20260731100000_create_payos_order_foundation.sql'),
    source('supabase/migrations/20260818235900_create_public_registration_batches.sql'),
    source('supabase/migrations/20260815120000_harden_payos_payment_intents.sql'),
    source('supabase/migrations/20260818120000_fix_payos_inclusive_periods_and_idempotency.sql'),
  ]);
  for (const column of ['active_slot', 'expires_at', 'superseded_by_order_id']) assert.match(hardening, new RegExp(column));
  for (const column of ['registration_batch_id', 'payment_intent_key', 'registration_request_id']) {
    assert.match(`${batches}\n${hardening}`, new RegExp(column));
  }
  for (const column of ['confirmed_at', 'processed_at', 'updated_at']) assert.match(foundation, new RegExp(column));
  assert.match(finalizer, /requested_start_date=new\.start_date,requested_end_date=new\.end_date/);
});
