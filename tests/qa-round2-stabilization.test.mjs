import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const [statusMigration, expenseMigration, journalMigration, kiosks, kioskService, expenses, expenseService,
  dates, payments, reports, logs, settings, homepageAdmin, navigation, layout, home, dashboard] = await Promise.all([
  read('../supabase/migrations/20260916150000_fix_status_read_permissions_and_kiosk_filters.sql'),
  read('../supabase/migrations/20260916151000_manage_expense_categories_and_workspace_kpis.sql'),
  read('../supabase/migrations/20260916152000_refine_business_journal.sql'),
  read('../src/pages/KiosksPage.js'), read('../src/services/KioskService.js'), read('../src/pages/ExpensesPage.js'),
  read('../src/services/ExpenseService.js'), read('../src/utils/date.js'), read('../src/pages/PaymentsPage.js'),
  read('../src/pages/ReportsPage.js'), read('../src/pages/LogsPage.js'), read('../src/pages/SettingsPage.js'),
  read('../src/pages/HomepageContentPage.js'), read('../src/constants/navigation.js'), read('../src/components/PublicLayout.js'),
  read('../src/pages/HomePage.js'), read('../src/services/DashboardService.js'),
]);

test('status read models use only the narrow warning-days helper and retain private settings', () => {
  assert.match(statusMigration, /warning_days integer := public\.get_status_warning_days\(\)/);
  assert.doesNotMatch(statusMigration, /from public\.settings/i);
  assert.match(statusMigration, /security definer/);
  assert.match(statusMigration, /has_user_permission\('kiosks'\)/);
  assert.match(statusMigration, /has_user_permission\('customers'\)/);
  assert.doesNotMatch(statusMigration, /grant select on (table )?public\.settings/i);
});

test('Kiosk list exposes only real business states with required semantics and sorting', () => {
  const optionBlock = kiosks.match(/function kioskStatusOptions[\s\S]*?\n}/)?.[0] || '';
  for (const status of ['active', 'warning', 'expired', 'suspended']) assert.match(optionBlock, new RegExp(`value: '${status}'`));
  assert.doesNotMatch(optionBlock, /pending/);
  assert.match(statusMigration, /lower\(p_status\)='active' and derived_status in \('active','warning'\)/);
  assert.match(kioskService, /status === 'warning'[\s\S]*end_date'[\s\S]*ascending: true/);
  assert.match(kioskService, /status === 'expired'[\s\S]*end_date'[\s\S]*ascending: false/);
});

test('admin history screens use runtime Vietnam year-to-date values and shared date fields', () => {
  assert.match(dates, /vietnamDateRangeYearToDate\(now = new Date\(\)\)/);
  assert.match(dates, /BUSINESS_TIME_ZONE/);
  for (const source of [payments, reports, logs, expenses]) assert.match(source, /DateRangeFields/);
  assert.match(expenses, /vietnamDateRangeYearToDate\(\)/);
  for (const source of [payments, reports, logs, expenses, dates]) assert.doesNotMatch(source, /2026-0[1-9]|2026-1[0-2]/);
});

test('Expense workspace uses one date range for expense, revenue and net profit', () => {
  assert.match(expenseMigration, /p_start_date is null or p\.revenue_date>=p_start_date/);
  assert.match(expenseMigration, /p_end_date is null or p\.revenue_date<=p_end_date/);
  assert.match(expenseMigration, /'netProfit',total_revenue-total_expense/);
  assert.match(expenses, /Tổng chi phí/);
  assert.match(expenses, /Tổng doanh thu/);
  assert.match(expenses, /Lợi nhuận ròng/);
});

test('managed expense categories support create rename archive and preserve historical FK rows', () => {
  assert.match(expenseMigration, /create table if not exists public\.expense_categories/);
  assert.match(expenseMigration, /category_id bigint references public\.expense_categories\(id\) on delete restrict/);
  assert.match(expenseMigration, /create or replace function public\.save_expense_category/);
  assert.match(expenseMigration, /create or replace function public\.archive_expense_category/);
  assert.doesNotMatch(expenseMigration, /delete from public\.expense_categories/i);
  assert.match(expenseService, /saveCategory/);
  assert.match(expenses, /Quản lý danh mục/);
});

test('default Business Logs exclude mirrored audit rows while technical history remains available', () => {
  assert.match(journalMigration, /private\.is_business_audit\(al\.action,al\.entity,al\.legacy_log_id/);
  assert.match(journalMigration, /coalesce\(nullif\(al\.actor_name,''\),'Admin'\).*đã cập nhật/);
  assert.match(logs, /showTechnical[\s\S]*AuditLogService\.list/);
  assert.match(logs, /BusinessEventService\.list/);
  assert.match(dashboard, /DASHBOARD_ACTIVITY_TYPES = \['registration', 'legacy', 'renewal'\]/);
});

test('Settings is the single sidebar workspace and reuses the canonical Homepage editor', () => {
  assert.match(settings, /HomepageContentAdmin/);
  assert.match(settings, /mountHomepageContentAdmin/);
  assert.match(homepageAdmin, /Nguồn nội dung duy nhất/);
  const systemSection = navigation.match(/label: 'HỆ THỐNG'[\s\S]*?\n  },/)?.[0] || '';
  assert.equal((systemSection.match(/route: 'settings'/g) || []).length, 1);
  assert.doesNotMatch(systemSection, /route: 'homepage-content'/);
});

test('public footer uses local branded assets, removes duplicate destinations and has compact empty UI', () => {
  for (const asset of ['icon-facebook.svg', 'icon-messenger.svg', 'icon-zalo.png']) assert.match(layout, new RegExp(asset.replace('.', '\\.')));
  assert.match(layout, /deduplicateChannels/);
  assert.doesNotMatch(layout, /https?:\/\/[^'"`]*\.(svg|png)/i);
  assert.match(home, /homepage-empty--compact/);
});
