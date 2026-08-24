import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const correctiveMigration = 'supabase/migrations/20260823013210_fix_status_warning_days_permissions.sql';

test('authenticated status RPCs use a narrow warning-days accessor', async () => {
  const sql = await read(correctiveMigration);
  assert.match(sql, /create or replace function public\.get_status_warning_days\(\)/i);
  assert.match(sql, /security definer[\s\S]*set search_path = ''/i);
  assert.match(sql, /from public\.settings s[\s\S]*where s\.key = 'warning_days'/i);
  assert.match(sql, /public\.get_kiosk_status_data[\s\S]*public\.get_customer_status_data/i);
  assert.match(sql, /warning_days := public\.get_status_warning_days\(\)/i);
});

test('permission fix never grants authenticated access to the settings table', async () => {
  const sql = await read(correctiveMigration);
  assert.doesNotMatch(sql, /grant\s+select[\s\S]*public\.settings/i);
  assert.match(sql, /revoke all on function public\.get_status_warning_days\(\) from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.get_status_warning_days\(\) to authenticated/i);
  assert.doesNotMatch(sql, /grant execute on function public\.get_status_warning_days\(\) to (?:public|anon)/i);
});

test('warning-days fallback and status contracts remain unchanged', async () => {
  const [fix, statusMigration] = await Promise.all([
    read(correctiveMigration),
    read('supabase/migrations/20260822224832_unify_crm_status_engine.sql'),
  ]);
  assert.match(fix, /when s\.value ~ '\^\\d\+\$' then s\.value::integer/);
  assert.match(fix, /coalesce\([\s\S]*30[\s\S]*\),\s*0\s*\)/);
  assert.doesNotMatch(fix, /create or replace function public\.resolve_(?:kiosk|customer)_status/i);
  assert.match(statusMigration, /when end_date_value < today_value then 'expired'/);
  assert.match(statusMigration, /when end_date_value <= today_value \+ greatest\(coalesce\(warning_days_value, 30\), 0\) then 'warning'/);
  assert.match(statusMigration, /when 'warning' = any\(kiosk_statuses\) then 'warning'/);
});

test('existing definer report and public-settings RPCs retain explicit authorization boundaries', async () => {
  const [report, publicSettings] = await Promise.all([
    read('supabase/migrations/20260822100000_authoritative_expiring_kiosk_reporting.sql'),
    read('supabase/migrations/20260819000500_include_warning_days_in_public_settings.sql'),
  ]);
  assert.match(report, /security definer[\s\S]*set search_path = ''/i);
  assert.match(report, /auth\.uid\(\) is null or not exists/i);
  assert.match(publicSettings, /where s\.key = any\(array\[[\s\S]*'warning_days'/i);
  assert.match(publicSettings, /revoke all on function public\.get_public_organization_settings\(\) from public, anon, authenticated/i);
});
