import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL('../supabase/migrations/20260822224832_unify_crm_status_engine.sql', import.meta.url);
const today = '2026-12-25';

function addDays(dateOnly, days) {
  const date = new Date(`${dateOnly}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function kioskStatus(record, warningDays) {
  const stored = String(record.status || 'inactive').toLowerCase();
  if (!['active', 'warning', 'expired'].includes(stored) || !record.end_date) return stored;
  if (record.end_date < today) return 'expired';
  if (record.end_date <= addDays(today, warningDays)) return 'warning';
  return 'active';
}

function customerStatus(stored, statuses) {
  if (stored !== 'active') return stored;
  if (!statuses.length) return 'active';
  return ['warning', 'active', 'pending', 'suspended', 'expired']
    .find((status) => statuses.includes(status)) || 'inactive';
}

for (const warningDays of [5, 10, 20, 30]) {
  test(`exact Kiosk sets are identical for warning_days=${warningDays}`, () => {
    const rows = [
      { id: 'expired-minus-1', status: 'active', end_date: addDays(today, -1) },
      { id: 'warning-0', status: 'active', end_date: addDays(today, 0) },
      { id: 'warning-1', status: 'warning', end_date: addDays(today, 1) },
      { id: 'warning-N', status: 'expired', end_date: addDays(today, warningDays) },
      { id: 'active-N-plus-1', status: 'warning', end_date: addDays(today, warningDays + 1) },
      { id: 'pending-old', status: 'pending', end_date: addDays(today, -1) },
      { id: 'suspended-old', status: 'suspended', end_date: addDays(today, -1) },
    ];
    const expected = {
      active: ['active-N-plus-1'],
      warning: ['warning-0', 'warning-1', 'warning-N'],
      expired: ['expired-minus-1'],
      pending: ['pending-old'],
      suspended: ['suspended-old'],
    };
    const consumers = ['dashboard', 'customers', 'kiosks', 'reportsSummary', 'reportsGrouping', 'filter', 'pagination'];
    for (const consumer of consumers) {
      const sets = Object.fromEntries(Object.keys(expected).map((status) => [
        status,
        rows.filter((row) => kioskStatus(row, warningDays) === status).map((row) => row.id),
      ]));
      assert.deepEqual(sets, expected, consumer);
    }
  });
}

test('customer status precedence is deterministic for mixed Kiosk sets', () => {
  assert.equal(customerStatus('active', ['active', 'expired']), 'active');
  assert.equal(customerStatus('active', ['expired', 'expired']), 'expired');
  assert.equal(customerStatus('active', ['warning', 'expired']), 'warning');
  assert.equal(customerStatus('active', ['suspended', 'active']), 'active');
  assert.equal(customerStatus('active', ['pending']), 'pending');
  assert.equal(customerStatus('active', []), 'active');
  assert.equal(customerStatus('inactive', ['active']), 'inactive');
  assert.equal(customerStatus('pending', ['active']), 'pending');
});

test('migration and services route every active status consumer through one SQL contract', async () => {
  const [sql, kioskService, customerService, dashboardService, reportService] = await Promise.all([
    readFile(migrationUrl, 'utf8'),
    readFile(new URL('../src/services/KioskService.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/services/CustomerService.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/services/DashboardService.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/services/ReportService.js', import.meta.url), 'utf8'),
  ]);
  assert.match(sql, /create or replace function public\.resolve_kiosk_status/);
  assert.match(sql, /now\(\) at time zone 'Asia\/Ho_Chi_Minh'/);
  assert.match(sql, /from public\.settings s where s\.key = 'warning_days'/);
  assert.match(sql, /get_dashboard_data[\s\S]*resolve_kiosk_status/);
  assert.match(sql, /limit 24', '\\1'/);
  assert.match(sql, /get_reports_data[\s\S]*resolve_kiosk_status/);
  assert.match(kioskService, /rpc\('get_kiosk_status_data'/);
  assert.match(customerService, /rpc\('get_customer_status_data'/);
  assert.match(dashboardService, /rpc\('get_dashboard_data'/);
  assert.match(reportService, /rpc\('get_reports_data'/);
});
