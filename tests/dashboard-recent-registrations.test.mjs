import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeRecentRegistrations } from '../src/services/DashboardService.js';

const migrationUrl = new URL('../supabase/migrations/20260819000600_dashboard_recent_registrations.sql', import.meta.url);
const historicalDashboardUrl = new URL('../supabase/supabase/migrations_ai_backup/20260725150000_create_dashboard_data_rpc.sql', import.meta.url);
const pageUrl = new URL('../src/pages/DashboardPage.js', import.meta.url);

test('dashboard normalizes single and multi-Kiosk registrations without replacing item amounts', () => {
  const registrations = normalizeRecentRegistrations([
    { id: 13, kioskName: 'Kiosk mới nhất', amount: '2000', createdAt: '2026-08-19T12:02:00Z' },
    { id: 12, kioskName: 'Kiosk B', amount: 2000, createdAt: '2026-08-19T12:01:00Z' },
    { id: 11, kioskName: 'Kiosk A', amount: 2000, createdAt: '2026-08-19T12:00:00Z' },
    { id: 10, kioskName: 'Đăng ký cũ', amount: 3500, createdAt: '2026-08-18T12:00:00Z' },
  ]);

  assert.deepEqual(registrations.map(({ id, amount }) => ({ id, amount })), [
    { id: 13, amount: 2000 },
    { id: 12, amount: 2000 },
    { id: 11, amount: 2000 },
    { id: 10, amount: 3500 },
  ]);
  assert.equal(registrations.some((item) => item.amount === 4000), false);
});

test('dashboard migration uses batch-item amount with registration-request fallback and newest-first order', async () => {
  const [sql, historicalDashboard] = await Promise.all([
    readFile(migrationUrl, 'utf8'),
    readFile(historicalDashboardUrl, 'utf8'),
  ]);

  assert.match(sql, /left join public\.registration_batch_items bi on bi\.registration_request_id = r\.id/);
  assert.match(sql, /when bi\.id is not null then bi\.total_amount\s+else coalesce\(r\.total_amount, 0\)/);
  assert.match(sql, /order by r\.submitted_at desc, r\.id desc\s+limit 5/);
  assert.match(sql, /'''recentRegistrations'', coalesce\(rr\.data, ''\[\]''::jsonb\)'/);
  assert.doesNotMatch(sql, /p\.total_amount as amount/);

  const oldCte = sql.match(/old_recent_customers text := \$old\$([\s\S]*?)\$old\$;/)?.[1];
  const newCte = sql.match(/new_recent_registrations text := \$new\$([\s\S]*?)\$new\$;/)?.[1];
  assert.ok(oldCte && historicalDashboard.includes(oldCte));
  assert.ok(newCte);
  const migratedDashboard = historicalDashboard
    .replace(oldCte, newCte)
    .replace("'recentCustomers', coalesce(rc.data, '[]'::jsonb)", "'recentRegistrations', coalesce(rr.data, '[]'::jsonb)")
    .replace('cross join recent_customers rc', 'cross join recent_registrations rr');
  assert.match(migratedDashboard, /'recentRegistrations'/);
  assert.doesNotMatch(migratedDashboard, /recentCustomers|cross join recent_customers rc/);
});

test('recent registration UI is limited to kiosk name, amount, and creation date', async () => {
  const source = await readFile(pageUrl, 'utf8');
  const renderer = source.slice(
    source.indexOf('function renderRecentRegistrations'),
    source.indexOf('function renderDashboardError'),
  );

  assert.match(renderer, /registration\.kioskName/);
  assert.match(renderer, /formatCurrency\(registration\.amount\)/);
  assert.match(renderer, /formatDate\(registration\.createdAt\)/);
  assert.match(renderer, /renderIcon\('store'\)/);
  assert.doesNotMatch(renderer, /status|categor|btn-|<button|[\u{1F300}-\u{1FAFF}]/u);
});
