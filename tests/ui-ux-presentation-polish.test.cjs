const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const navigation = read('src/constants/navigation.js');
const layout = read('src/layouts/AppLayout.js');
const app = read('src/app.js');
const reports = read('src/pages/ReportsPage.js');
const promotions = read('src/pages/PromotionsPage.js');
const statusBadge = read('src/components/StatusBadge.js');
const css = read('src/styles/app.css');
const notificationMigration = read('supabase/migrations/20261008172650_persist_crm_notifications.sql');

test('Dashboard stays standalone and section labels keep permitted items visible', () => {
  assert.match(navigation, /label: 'TỔNG QUAN',[\s\S]*standalone: true/);
  for (const label of ['QUẢN LÝ CRM', 'HỆ THỐNG']) assert.match(navigation, new RegExp(label));
  assert.doesNotMatch(navigation, /TƯƠNG TÁC CHÉO|ttc/i);
  assert.match(layout, /<div class="nav-section"[\s\S]*<div class="nav-section-label">/);
  assert.match(layout, /section\.collapsible[\s\S]*nav-section-collapsible/);
  assert.doesNotMatch(app, /collapsibleNavSections|activeSection/);
  assert.match(css, /\.nav-section-label\{min-height:25px/);
});

test('Reports overview contains exactly the six business-facing KPI cards', () => {
  const overview = reports.match(/function renderOverview[\s\S]*?function renderRevenue/)?.[0] || '';
  const cards = overview.match(/renderSummaryCards\(\[([\s\S]*?)\]\)/)?.[1] || '';
  const labels = ['Hồ sơ cần xử lý', 'Hồ sơ chờ thanh toán', 'Kiosk hoạt động', 'Kiosk sắp hết hạn', 'Kiosk hết hạn', 'Doanh thu trong kỳ'];
  for (const label of labels) assert.match(cards, new RegExp(label));
  assert.equal((cards.match(/\bcard\('/g) || []).length, 6);
  assert.doesNotMatch(cards, /Thanh toán hoàn thành|Giao dịch Pending|Kiosk chờ duyệt/);
  assert.match(css, /\.reports-page\{display:grid;gap:var\(--space-card\)/);
});

test('notification popup uses server ordering and closes outside or with Escape without summary copy', () => {
  assert.doesNotMatch(layout, /data-notification-summary/);
  assert.match(app, /const items = data\.items/);
  assert.match(read('src/services/AdminNotificationService.js'), /get_crm_notifications/);
  assert.match(notificationMigration, /order by \(read_at is null\) desc, \(resolved_at is null\) desc, created_at desc, id desc/);
  assert.match(app, /notificationCenter\?\.open && !notificationCenter\.contains/);
  assert.match(app, /event\.key !== 'Escape'[\s\S]*notificationCenter\?\.open/);
  assert.match(css, /\.admin-notification-popover\{width:min\(380px/);
});

test('Promotions uses one overflow-safe accessible action menu with destructive styling', () => {
  assert.match(promotions, /data-promotion-menu-trigger aria-haspopup="menu" aria-expanded="false">Thao tác/);
  for (const action of ['edit', 'details', 'toggle', 'delete']) assert.match(promotions, new RegExp(`data-promotion-action="${action}"`));
  assert.match(promotions, /ArrowDown/);
  assert.match(promotions, /event\.key==='Escape'/);
  assert.match(css, /\.promotion-action-dropdown\{position:fixed/);
  assert.match(css, /button\.is-danger/);
  assert.doesNotMatch(promotions, /CompactAction/);
});

test('inactive and cancelled records cannot inherit the active presentation', () => {
  assert.match(statusBadge, /inactive: 'Không hoạt động'/);
  assert.match(statusBadge, /cancelled: 'Đã hủy'/);
  assert.match(statusBadge, /inactive: 'neutral'/);
  assert.match(statusBadge, /cancelled: 'danger'/);
});
