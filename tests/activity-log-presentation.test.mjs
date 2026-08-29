import assert from 'node:assert/strict';
import test from 'node:test';

import {
  activityLogPresentation as logUi,
  actorDisplayName,
  businessChanges,
  categoryForLog,
  formatAuditLog,
  sourceLabel,
} from '../src/utils/auditLogPresentation.js';

test('technical action and module codes are translated without leaking internal vocabulary', () => {
  assert.equal(logUi.actionLabel('admin_manual_renewal'), 'Gia hạn');
  assert.equal(logUi.actionLabel('confirm_payos_batch'), 'PayOS xác nhận');
  assert.equal(logUi.actionLabel('update'), 'Cập nhật');
  assert.equal(logUi.moduleLabel('customers'), 'Khách hàng');
  assert.equal(logUi.moduleLabel('kiosks'), 'Kiosk');
  assert.equal(logUi.moduleLabel('Payment'), 'Thanh toán');
  assert.equal(logUi.moduleLabel('unknown_internal_table'), 'Đối tượng');
  assert.equal(logUi.actionLabel('unknown_internal_code'), 'Sự kiện tự động');
});

test('manual renewal summary uses Kiosk, period, package and currency in business format', () => {
  const log = {
    action: 'admin_manual_renewal', module: 'Renewal', actor_name: 'Nguyễn Thanh Hân',
    before: { kiosk: { id: 7, facebook_name: 'Kiosk ABC' } },
    after: { months: 1, actual_amount: 300000, new_start_date: '2026-08-01', new_expiry_date: '2026-08-31' },
    resolved_entity: { kind: 'Kiosk', name: 'Kiosk ABC', id: '7', missing: false },
  };
  const item = formatAuditLog(log);
  assert.equal(item.objectName, 'Kiosk ABC');
  assert.equal(item.title, 'Kiosk ABC được gia hạn');
  assert.match(item.secondary, /Gói 1 tháng/);
  assert.match(item.secondary, /01\/08\/2026 → 31\/08\/2026/);
  assert.match(item.secondary, /300\.000/);
});

test('PayOS and automatic actors have explicit business source labels', () => {
  const payos = { action: 'confirm_payos', actor_name: 'System', actor_type: 'system', reason: 'PayOS webhook' };
  assert.equal(actorDisplayName(payos), 'Hệ thống PayOS');
  assert.equal(sourceLabel(payos), 'PayOS');
  assert.equal(actorDisplayName({ action: 'expire', actor_type: 'database_trigger' }), 'Hệ thống tự động');
  assert.equal(sourceLabel({ action: 'expire', actor_type: 'database_trigger' }), 'Tự động');
});

test('missing entity name falls back to stored payment data without fabrication', () => {
  const log = { action: 'confirm_payos_batch', module: 'Payment', record_id: '42', after: { payment_id: 99, amount: 450000, kiosk_count: 2 } };
  const item = formatAuditLog(log);
  assert.equal(item.objectName, 'Thanh toán 450.000 VNĐ');
  assert.match(item.title, /Thanh toán 450\.000 VNĐ đã được PayOS xác nhận/);
  assert.doesNotMatch(item.title, /undefined|null|Nhóm khác/);
});

test('resolved Kiosk and promotion names replace database ids in primary copy', () => {
  const kiosk = {
    action: 'review_legacy_approve', module: 'Registration', record_id: '88', actor_name: 'Nguyễn Thanh Hân',
    after: { kiosk_id: 277 }, resolved_entity: { kind: 'Kiosk', name: 'Khánh Ly', id: '277', missing: false },
  };
  assert.equal(logUi.entityDisplayName(kiosk), 'Kiosk Khánh Ly');
  assert.match(logUi.humanLogSummary(kiosk), /Nguyễn Thanh Hân đã duyệt Kiosk Khánh Ly/);
  assert.doesNotMatch(logUi.humanLogSummary(kiosk), /#277/);

  const promotion = {
    action: 'pause_promotion', module: 'Promotion', record_id: '9', actor_name: 'Admin',
    resolved_entity: { kind: 'Mã giảm giá', name: 'TANG1THANG', id: '9', missing: false },
  };
  assert.equal(logUi.entityDisplayName(promotion), 'Mã giảm giá TANG1THANG');
  assert.equal(logUi.humanLogSummary(promotion), 'Mã giảm giá TANG1THANG đã được tạm ngưng');
  assert.equal(logUi.humanLogSummary({ ...promotion, action: 'delete_promotion' }), 'Mã giảm giá TANG1THANG đã bị xóa');
});

test('business type and category ids resolve on both sides of a change', () => {
  const log = {
    action: 'update', module: 'Kiosk', actor_name: 'Admin',
    before: { business_type_id: 47, category_id: 3 }, after: { business_type_id: 52, category_id: 4 },
    resolved_entity: { kind: 'Kiosk', name: 'ABC', id: '5', missing: false },
    resolved_names: { businessTypes: { 47: 'Đồ ăn', 52: 'Đồ uống' }, categories: { 3: 'Ẩm thực', 4: 'Dịch vụ' } },
  };
  const changes = businessChanges(log);
  assert.deepEqual(changes.map(({ label, before, after }) => ({ label, before, after })), [
    { label: 'Ngành nghề', before: 'Đồ ăn', after: 'Đồ uống' },
    { label: 'Danh mục', before: 'Ẩm thực', after: 'Dịch vụ' },
  ]);
  assert.doesNotMatch(formatAuditLog(log).secondary, /#47|#52|#3|#4|Nhóm khác/);
});

test('user permissions, wallet and backward-compatible unknown logs stay readable', () => {
  const permission = {
    action: 'sync_permissions', module: 'UserManagement', actor_name: 'Admin',
    before: { permissions: ['dashboard'] }, after: { permissions: ['dashboard', 'logs'] },
    resolved_entity: { kind: 'Người dùng', name: 'Lan Anh', id: 'user-1', missing: false },
  };
  const permissionItem = formatAuditLog(permission);
  assert.equal(categoryForLog(permission), 'user');
  assert.match(permissionItem.title, /Admin đã thay đổi quyền của Người dùng Lan Anh/);
  assert.doesNotMatch(permissionItem.secondary, /dashboard|logs/);

  const wallet = {
    action: 'adjust_wallet', module: 'UserManagement', actor_name: 'Admin',
    before: { balance: 100000 }, after: { balance: 250000 },
    resolved_entity: { kind: 'Người dùng', name: 'Lan Anh', id: 'user-1', missing: false },
  };
  assert.match(formatAuditLog(wallet).title, /100\.000 VNĐ → 250\.000 VNĐ/);

  const old = formatAuditLog({ action: 'legacy_internal_event', module: 'legacy_table', record_id: '47', actor_name: 'System' });
  assert.equal(old.objectName, 'Đối tượng #47');
  assert.equal(old.technical, true);
  assert.doesNotMatch(old.title, /undefined|null|Nhóm khác/);
});

test('unresolved foreign keys are clearly marked as ids and raw payload stays technical', () => {
  const log = {
    action: 'update', module: 'Kiosk',
    before: { business_type_id: 47, raw_payload: { secret: true } },
    after: { business_type_id: 52, raw_payload: { secret: false } },
  };
  assert.deepEqual(businessChanges(log), [
    { field: 'business_type_id', label: 'Ngành nghề', before: 'Ngành nghề #47', after: 'Ngành nghề #52' },
  ]);
});
