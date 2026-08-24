const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migrationPath = path.join(__dirname, '../supabase/migrations/20260824203533_fix_promotion_save_ambiguous_columns.sql');
const sql = fs.readFileSync(migrationPath, 'utf8');

test('promotion save corrective migration replaces only the affected RPC', () => {
  assert.match(sql, /create or replace function public\.admin_save_promotion\(/i);
  assert.equal((sql.match(/create or replace function/gi) || []).length, 1);
  assert.doesNotMatch(sql, /create\s+table|alter\s+table|drop\s+table/i);
});

test('promotion save scope IDs are explicitly qualified', () => {
  assert.match(sql, /category_scope\(category_id\)/);
  assert.match(sql, /c\.id\s*=\s*category_scope\.category_id/);
  assert.match(sql, /business_type_scope\(business_type_id\)/);
  assert.match(sql, /bt\.id\s*=\s*business_type_scope\.business_type_id/);
  assert.match(sql, /select distinct saved\.id, category_scope\.category_id/);
  assert.match(sql, /select distinct saved\.id, business_type_scope\.business_type_id/);
});

test('affected RPC contains no known unqualified ambiguous references', () => {
  for (const unsafe of [
    /\bon\s+c\.id\s*=\s*id\b/i,
    /\bon\s+bt\.id\s*=\s*id\b/i,
    /select\s+distinct\s+saved\.id\s*,\s*id\b/i,
    /where\s+id\s*=\s*promotion_id_input/i,
    /where\s+promotion_id\s*=\s*saved\.id/i,
  ]) assert.doesNotMatch(sql, unsafe);

  assert.match(sql, /where p\.id = promotion_id_input/);
  assert.match(sql, /where pc\.promotion_id = saved\.id/);
  assert.match(sql, /where pbt\.promotion_id = saved\.id/);
});

test('corrective RPC preserves authorization and execute grants', () => {
  assert.match(sql, /security definer[\s\S]*set search_path = ''/i);
  assert.match(sql, /ur\.user_id = \(select auth\.uid\(\)\)/);
  assert.match(sql, /pg_catalog\.lower\(ur\.role\) = 'admin'/);
  assert.match(sql, /revoke all on function[\s\S]*from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function[\s\S]*to authenticated/i);
});
