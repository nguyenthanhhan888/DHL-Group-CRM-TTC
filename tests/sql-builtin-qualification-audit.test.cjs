const test = require('node:test');
const assert = require('node:assert/strict');
const { readdir, readFile } = require('node:fs/promises');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const migrations = path.join(root, 'supabase/migrations');
const finalHotfixPath = path.join(migrations, '20260819000200_fix_payos_sql_builtin_qualifications.sql');

const callableOrRelation = new Set([
  'array_length', 'hashtextextended', 'lower', 'make_interval', 'now',
  'pg_advisory_xact_lock', 'pg_get_functiondef', 'pg_trigger', 'regexp_replace',
  'replace', 'set_config', 'string_agg', 'strpos', 'unnest',
]);
const invalidSpecialForms = new Set([
  'coalesce', 'trim', 'nullif', 'greatest', 'least', 'extract',
  'current_date', 'current_timestamp', 'case', 'cast', 'date', 'interval',
  'position',
]);

test('every pg_catalog symbol in active migrations is explicitly classified', async () => {
  const files = (await readdir(migrations)).filter((file) => file.endsWith('.sql'));
  const occurrences = [];
  for (const file of files) {
    const sql = await readFile(path.join(migrations, file), 'utf8');
    for (const match of sql.matchAll(/pg_catalog\.([a-z_][a-z0-9_]*)/gi)) {
      occurrences.push({ file, name: match[1].toLowerCase() });
    }
  }

  const unknown = occurrences.filter(({ name }) => !callableOrRelation.has(name) && !invalidSpecialForms.has(name));
  assert.deepEqual(unknown, [], `unclassified pg_catalog symbols: ${JSON.stringify(unknown)}`);

  const invalidInExecutableHistory = [...new Set(
    occurrences
      .filter(({ name }) => invalidSpecialForms.has(name))
      .filter(({ file }) => file === '20260818235900_create_public_registration_batches.sql')
      .map(({ name }) => name),
  )].sort();
  assert.deepEqual(invalidInExecutableHistory, ['coalesce', 'trim']);
});

test('final hotfix recreates every active batch function and removes all invalid special forms', async () => {
  const hotfix = await readFile(finalHotfixPath, 'utf8');
  for (const signature of [
    'public.prepare_registration_batch_for_payos(bigint[],text)',
    'private.confirm_registration_batch_from_payos(bigint,text)',
    'public.record_registration_payos_order(bigint,bigint,numeric,text,text,text,text,jsonb)',
    'public.handle_payos_webhook(bigint,numeric,text,text,jsonb,text,text)',
  ]) {
    assert.ok(hotfix.includes(`'${signature}'::regprocedure`), `missing final hotfix target ${signature}`);
  }

  assert.match(hotfix, /catalog_prefix \|\| 'coalesce\('/);
  assert.match(hotfix, /catalog_prefix \|\| 'trim\('/);
  assert.match(hotfix, /'btrim\('/);
  assert.match(hotfix, /execute corrected_definition/);
  for (const name of invalidSpecialForms) {
    assert.match(hotfix, new RegExp(`'${name}'`), `missing guard for pg_catalog.${name}`);
  }
  assert.doesNotMatch(hotfix, /drop\s+(function|table)|delete\s+from|truncate/i);
});

test('the pre-PayOS and webhook dependency functions contain no invalid qualification', async () => {
  const dependencyFiles = [
    '20260731090000_create_ttc_user_wallet_foundation.sql',
    '20260815120000_harden_payos_payment_intents.sql',
    '20260818120000_fix_payos_inclusive_periods_and_idempotency.sql',
  ];
  const invalidCall = /pg_catalog\.(?:coalesce|trim|nullif|greatest|least|extract|current_date|current_timestamp|case|cast|date|interval)\s*\(?/i;
  for (const file of dependencyFiles) {
    const sql = await readFile(path.join(migrations, file), 'utf8');
    assert.doesNotMatch(sql, invalidCall, `${file} contains an invalid qualified SQL special form`);
  }
});
