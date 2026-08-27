const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const navigation = read('src/constants/navigation.js');
const requests = read('src/pages/RegistrationRequestsPage.js');
const reports = read('src/pages/ReportsPage.js');
const toast = read('src/components/Toast.js');
const buttons = read('src/utils/buttonState.js');
const notifications = read('src/services/AdminNotificationService.js');
const layout = read('src/layouts/AppLayout.js');
const app = read('src/app.js');
const logs = read('src/pages/LogsPage.js');
const css = read('src/styles/app.css');
const migration = read('supabase/migrations/20260827120000_deactivate_cancelled_public_provisional_kiosks.sql');

test('Hồ sơ Kiosk copy keeps payment, review and Kiosk states distinct', () => {
  assert.match(navigation, /'registration-requests': 'Hồ sơ Kiosk'/);
  assert.match(requests, /title: 'Hồ sơ Kiosk'/);
  assert.match(requests, /Chờ thanh toán[\s\S]*PayOS chưa tạo doanh thu/);
  assert.match(requests, /Chờ duyệt[\s\S]*Legacy\/Bổ sung/);
  assert.match(reports, /Giao dịch Pending/);
  assert.match(reports, /Hồ sơ chờ thanh toán/);
});

test('global toast and reusable busy button expose accessible compact states', () => {
  for (const tone of ['success', 'info', 'warning', 'error']) assert.match(toast, new RegExp(`${tone}:`));
  assert.match(toast, /role[^\n]*alert/);
  assert.match(css, /\.toast-container\s*\{[^}]*position:\s*fixed;[^}]*top:/);
  assert.match(css, /\.toast-icon svg,.toast-close svg\{width:18px;height:18px;fill:none;stroke:currentColor/);
  assert.match(buttons, /setAttribute\('aria-busy', 'true'\)/);
  assert.match(buttons, /button\.disabled = true/);
  assert.match(buttons, /style\.minWidth/);
  assert.match(requests, /setButtonBusy\(button, true/);
});

test('notification badge counts unread lifecycle-deduped items and supports mark all read', () => {
  assert.match(notifications, /new Map\(items\.map/);
  assert.match(notifications, /request:pending:/);
  assert.match(notifications, /request:awaiting_payment:/);
  assert.match(notifications, /kiosk:\$\{String\(item\.derivedStatus\)/);
  assert.match(notifications, /unreadCount/);
  assert.match(notifications, /markAllRead/);
  assert.match(layout, /data-notification-mark-all/);
  assert.match(app, /data\.unreadCount/);
  assert.match(app, /is-read':'is-unread/);
});

test('business logs name Admin cancellation while raw identifiers stay in technical details', () => {
  assert.match(logs, /admin_cancel: 'Hủy hồ sơ Kiosk'/);
  assert.match(logs, /Đã hủy hồ sơ chưa thanh toán/);
  assert.match(logs, /Chi tiết kỹ thuật/);
  assert.match(logs, /resolved_entity/);
});

test('cancelled public provisional Kiosks become inactive without touching completed Kiosks', () => {
  assert.match(migration, /r\.metadata->>'workflow' = 'public_payos'/);
  assert.match(migration, /r\.status = 'cancelled'/);
  assert.match(migration, /b\.status = 'cancelled'/);
  assert.match(migration, /completed_payment\.payment_status = 'completed'/);
  assert.match(migration, /set status = 'inactive'/);
  assert.match(migration, /status in \('pending', 'inactive'\)/);
  assert.match(migration, /create or replace function public\.admin_cancel_awaiting_registration/);
  assert.match(migration, /security definer[\s\S]*set search_path = ''/);
  assert.match(migration, /revoke all on function public\.admin_cancel_awaiting_registration\(bigint, text\)[\s\S]*from public, anon, authenticated/);
  assert.doesNotMatch(migration, /\bcascade\b/i);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.(payments|kiosks|registration_requests)/i);
});
