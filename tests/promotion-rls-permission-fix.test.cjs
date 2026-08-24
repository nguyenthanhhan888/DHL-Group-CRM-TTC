const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260824204309_fix_promotion_rls_admin_authorization.sql'), 'utf8');
const saveFix = fs.readFileSync(path.join(root, 'supabase/migrations/20260824203533_fix_promotion_save_ambiguous_columns.sql'), 'utf8');

test('Promotion RLS uses a narrow definer helper instead of caller access to user_roles', () => {
  assert.match(migration, /function public\.is_active_promotion_admin\(\)/);
  assert.match(migration, /security definer[\s\S]*set search_path = ''/i);
  assert.match(migration, /from public\.user_roles as ur/);
  assert.match(migration, /ur\.user_id = \(select auth\.uid\(\)\)/);
  assert.match(migration, /pg_catalog\.lower\(ur\.role\) = 'admin'/);
  assert.match(migration, /ur\.is_active = true/);
});

test('all Promotion Admin policies use the helper and no policy queries user_roles directly', () => {
  for (const policy of [
    'promotions_admin_all',
    'promotion_categories_admin_all',
    'promotion_business_types_admin_all',
    'promotion_usages_admin_read',
  ]) assert.match(migration, new RegExp(`create policy ${policy}[\\s\\S]*?is_active_promotion_admin\\(\\)`));

  const policySql = migration.slice(migration.indexOf('drop policy'));
  assert.doesNotMatch(policySql, /from public\.user_roles/i);
});

test('Admin can read and pause while ordinary authenticated and anon users remain denied by RLS', () => {
  assert.match(migration, /grant select on table public\.promotions,public\.promotion_categories,[\s\S]*public\.promotion_usages[\s\S]*to authenticated/i);
  assert.match(migration, /grant update\(is_active\) on table public\.promotions to authenticated/i);
  assert.match(migration, /for all[\s\S]*to authenticated[\s\S]*using \(\(select public\.is_active_promotion_admin\(\)\)\)/i);
  assert.match(migration, /revoke all on table[\s\S]*from public,anon/i);
  assert.doesNotMatch(migration, /grant\s+select\s+on(?:\s+table)?\s+public\.user_roles/i);
});

test('helper execution and save RPC remain restricted correctly', () => {
  assert.match(migration, /revoke all on function public\.is_active_promotion_admin\(\)[\s\S]*from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.is_active_promotion_admin\(\)[\s\S]*to authenticated/i);
  assert.match(saveFix, /revoke all on function public\.admin_save_promotion\(bigint,jsonb,bigint\[\],bigint\[\]\)[\s\S]*from public, anon, authenticated/i);
  assert.match(saveFix, /grant execute on function public\.admin_save_promotion\(bigint,jsonb,bigint\[\],bigint\[\]\)[\s\S]*to authenticated/i);
});
