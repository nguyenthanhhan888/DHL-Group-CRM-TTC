import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { expiryDateRange, isExpiringSoon } from '../src/utils/kioskStatus.js';

const migrationUrl = new URL('../supabase/migrations/20260822100000_authoritative_expiring_kiosk_reporting.sql', import.meta.url);

function dateOnlyFrom(base, offset) {
  const date = new Date(base);
  date.setDate(date.getDate() + offset);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

for (const warningDays of [5, 10, 20, 30]) {
  test(`inclusive warning boundary holds for warning_days=${warningDays}`, () => {
    const today = new Date(2026, 11, 28);
    today.setHours(0, 0, 0, 0);
    assert.equal(isExpiringSoon({ end_date: dateOnlyFrom(today, -1) }, { warningDays, today }), false);
    assert.equal(isExpiringSoon({ end_date: dateOnlyFrom(today, 0) }, { warningDays, today }), true);
    assert.equal(isExpiringSoon({ end_date: dateOnlyFrom(today, warningDays) }, { warningDays, today }), true);
    assert.equal(isExpiringSoon({ end_date: dateOnlyFrom(today, warningDays + 1) }, { warningDays, today }), false);
  });
}

test('warning range crosses month and year boundaries as calendar dates', () => {
  const today = new Date(2026, 11, 28);
  const range = expiryDateRange({ warningDays: 10, today });
  assert.equal(range.startDate, '2026-12-28');
  assert.equal(range.endDate, '2027-01-07');
});

test('RPC uses settings warning_days and one Vietnam report date', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /from public\.settings s\s+where s\.key = 'warning_days'/i);
  assert.match(sql, /today_date date := \(now\(\) at time zone 'Asia\/Ho_Chi_Minh'\)::date/i);
  assert.match(sql, /'warningDays', warning_days/);
  assert.match(sql, /'reportDate', today_date/);
  assert.ok((sql.match(/end_date between today_date and today_date \+ warning_days/g) || []).length >= 5);
});

test('kiosk card count, rows, filters, and pagination use one filtered CTE', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  const kioskBranch = sql.match(/elsif report_type = 'kiosks'[\s\S]*?elsif report_type = 'customers'/)?.[0] || '';
  assert.match(kioskBranch, /filtered as \([\s\S]*p_customer_id[\s\S]*p_kiosk_id[\s\S]*p_category_id[\s\S]*p_business_type_id/);
  assert.match(kioskBranch, /lower\(p_kiosk_status\) = 'expiring_soon'[\s\S]*end_date between today_date and today_date \+ warning_days/);
  assert.match(kioskBranch, /count\(\*\) filter \(where expiring_soon\)::bigint as expiring_soon\s+from filtered/);
  assert.match(kioskBranch, /case when expiring_soon then 'warning' else status end as status/);
  assert.match(kioskBranch, /select count\(\*\)::bigint as total_rows from filtered/);
  assert.match(kioskBranch, /from filtered[\s\S]*limit p_page_size offset row_offset/);
});

test('stored active and warning states share the same inclusive derived rule', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.doesNotMatch(sql, /lower\((?:k|fk|status)\.?(?:status)?\) = 'active'\s+and (?:k|fk)?\.?end_date between today_date and today_date \+ warning_days/);
  assert.match(sql, /lower\(k\.status\) in \('active', 'warning'\)\s+and k\.end_date between today_date and today_date \+ warning_days/);
});

test('ReportService never applies a frontend expiring override', async () => {
  const source = await readFile(new URL('../src/services/ReportService.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /KioskService|patchExpiringKioskReport|getExpiringKiosks|deriveKioskStatus|daysUntil/);
  assert.match(source, /return \{ data: normalizeResponse\(data, normalizedTab, page, pageSize\) \}/);
  assert.match(source, /warningDays: nonNegativeNumber\(report\.warningDays\)/);
});

test('report RPC retains permissions and pagination validation', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /security definer\s+set search_path = ''/i);
  assert.match(sql, /auth\.uid\(\) is null[\s\S]*role_permissions/);
  assert.match(sql, /p_page_size is null or p_page_size not in \(25, 50, 100\)/);
  assert.match(sql, /revoke all on function public\.get_reports_data[\s\S]*from public/);
  assert.match(sql, /revoke all on function public\.get_reports_data[\s\S]*from anon/);
  assert.match(sql, /grant execute on function public\.get_reports_data[\s\S]*to authenticated/);
});
