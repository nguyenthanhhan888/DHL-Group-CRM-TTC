import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const dashboard = read('src/services/DashboardService.js');
const dashboardPage = read('src/pages/DashboardPage.js');
const reports = read('src/pages/ReportsPage.js');
const notifications = read('src/services/AdminNotificationService.js');
const notificationMigration = read('supabase/migrations/20260916120000_qa_round1_core_stabilization.sql');
const layout = read('src/layouts/AppLayout.js');
const logs = read('src/pages/LogsPage.js');
const register = read('src/pages/RegisterPage.js');
const home = read('src/pages/HomePage.js');
const css = read('src/styles/app.css');

test('overview presents business KPIs while the notification RPC keeps request states separate', () => {
  const overview = reports.match(/function renderOverview[\s\S]*?function renderRevenue/)?.[0] || '';
  const cards = overview.match(/renderSummaryCards\(\[([\s\S]*?)\]\)/)?.[1] || '';
  for (const label of ['Hồ sơ cần xử lý', 'Hồ sơ chờ thanh toán', 'Kiosk hoạt động', 'Kiosk sắp hết hạn', 'Kiosk hết hạn', 'Doanh thu trong kỳ']) assert.match(cards, new RegExp(label));
  assert.doesNotMatch(cards, /Giao dịch Pending|Kiosk chờ duyệt/);
  assert.match(notifications, /get_registration_actionable_summary/);
  assert.match(notificationMigration, /pendingReviewCount/);
  assert.match(notificationMigration, /awaitingPaymentCount/);
});

test('Recent Activity consumes shared business events instead of inferring payment lifecycle again', () => {
  assert.match(dashboard, /DASHBOARD_ACTIVITY_TYPES = \['registration', 'legacy', 'renewal'\]/);
  assert.match(dashboard, /BusinessEventService\.list\(\{[\s\S]*context: 'dashboard', activity/);
  assert.doesNotMatch(dashboard, /from\('payments'\)|from\('registration_requests'\)|get_audit_logs/);
  assert.match(dashboardPage, /Hoạt động gần đây/);
  assert.doesNotMatch(dashboardPage, /Đăng ký gần đây/);
});

test('shared registration, renewal and legacy event types have semantic presentations', () => {
  for (const type of ['registration', 'renewal', 'legacy']) assert.match(dashboardPage, new RegExp(`${type}:`));
  assert.doesNotMatch(dashboard, /Thanh toán thành công|payment_intent_key|registration_batch_id/);
});

test('notification badge counts only Admin-actionable review and reconciliation states', () => {
  assert.match(layout, /admin-notification-center/);
  assert.match(layout, /data-registration-nav-count/);
  assert.match(notifications, /unreadCount = pendingCount \+ reconciliationCount/);
  assert.match(notifications, /pendingReviewCount: pendingCount/);
  assert.match(notifications, /awaitingPaymentCount: awaitingCount/);
  assert.match(notifications, /registrationCount: pendingCount \+ reconciliationCount/);
  assert.doesNotMatch(notifications, /request:awaiting_payment:/);
});

test('business log view uses business events by default and raw audit only in technical mode', () => {
  assert.match(logs, /showTechnical:\s*false/);
  assert.match(logs, /state\.showTechnical[\s\S]*AuditLogService\.list/);
  assert.match(logs, /BusinessEventService\.list/);
  assert.doesNotMatch(logs, /logs\.filter\(isBusinessActivity\)/);
  assert.match(logs, /Thông tin kỹ thuật/);
  assert.match(logs, /renderRawJson/);
});

test('brand, registration, compact badge, data-backed Home and TTC copy contracts are corrected', () => {
  assert.match(layout, /top-bar-context">Diễn Châu - À Đây Rồi \(DHL\)/);
  assert.doesNotMatch(layout, /sidebar-sub">DHL Group/);
  assert.doesNotMatch(register, /data-price-equation/);
  assert.match(css, /padding:4px 8px/);
  assert.match(css, /font-weight:600/);
  assert.match(home, /HomepageContentService\.getPublic/);
  assert.match(home, /renderFeaturedBusinesses/);
  assert.doesNotMatch(home, /tham gia TTC/);
});
