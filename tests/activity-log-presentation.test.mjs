import assert from 'node:assert/strict';
import test from 'node:test';

import { activityLogPresentation as logUi } from '../src/pages/LogsPage.js';

test('technical action and module codes are translated for the primary log UI', () => {
  assert.equal(logUi.actionLabel('admin_manual_renewal'), 'Gia hạn Kiosk');
  assert.equal(logUi.actionLabel('confirm_payos_batch'), 'Xác nhận thanh toán PayOS');
  assert.equal(logUi.actionLabel('update'), 'Cập nhật');
  assert.equal(logUi.moduleLabel('customers'), 'Khách hàng');
  assert.equal(logUi.moduleLabel('kiosks'), 'Kiosk');
  assert.equal(logUi.moduleLabel('Payment'), 'Thanh toán');
  assert.equal(logUi.moduleLabel('unknown_internal_table'), 'Nhóm khác');
  assert.equal(logUi.actionLabel('unknown_internal_code'), 'Hoạt động hệ thống');
});

test('manual renewal summary uses stored actor, Kiosk name, months and amount', () => {
  const log = {
    action: 'admin_manual_renewal',
    module: 'Renewal',
    actor_name: 'Nguyễn Thanh Hân',
    before: { kiosk: { id: 7, facebook_name: 'Kiosk ABC' } },
    after: { months: 1, actual_amount: 300000 },
  };
  assert.equal(logUi.entityDisplayName(log), 'Kiosk ABC');
  assert.equal(logUi.humanLogSummary(log), 'Kiosk ABC · thêm 1 tháng');
  assert.match(logUi.importantChange(log), /1 tháng.*300\.000/);
});

test('missing entity name falls back to a real stored identifier without fabrication', () => {
  const log = {
    action: 'confirm_payos_batch',
    module: 'Payment',
    record_id: '42',
    after: { payment_id: 99, amount: 450000, kiosk_count: 2 },
  };
  assert.equal(logUi.entityDisplayName(log), 'Thanh toán #42');
  assert.equal(logUi.humanLogSummary(log), 'Thanh toán #42 · thanh toán PayOS đã xác nhận');
});

test('common audit fields have human-readable labels', () => {
  assert.equal(logUi.fieldLabel('start_date'), 'Ngày bắt đầu');
  assert.equal(logUi.fieldLabel('end_date'), 'Ngày hết hạn');
  assert.equal(logUi.fieldLabel('status'), 'Trạng thái');
  assert.equal(logUi.fieldLabel('phone'), 'Số điện thoại');
});

test('resolved Kiosk name replaces its database id in primary activity copy', () => {
  const log = {
    action: 'review_legacy_approve', module: 'Registration', record_id: '88',
    actor_name: 'Nguyễn Thanh Hân', after: { kiosk_id: 277 },
    resolved_entity: { kind: 'Kiosk', name: 'Khánh Ly', id: '277', missing: false },
  };
  assert.equal(logUi.entityDisplayName(log), 'Kiosk Khánh Ly');
  assert.equal(logUi.humanLogSummary(log), 'Kiosk Khánh Ly · duyệt hồ sơ bổ sung');
  assert.doesNotMatch(logUi.humanLogSummary(log), /#277/);
});

test('deleted historical Kiosk and resolved promotion use safe business labels', () => {
  assert.equal(logUi.entityDisplayName({
    action: 'update', module: 'Kiosk', record_id: '277',
    resolved_entity: { kind: 'Kiosk', name: null, id: '277', missing: true },
  }), 'Kiosk đã xóa');
  const promotion = {
    action: 'pause_promotion', module: 'Promotion', record_id: '9', actor_name: 'Admin',
    resolved_entity: { kind: 'Mã giảm giá', name: 'TANG1THANG', id: '9', missing: false },
  };
  assert.equal(logUi.entityDisplayName(promotion), 'Mã giảm giá TANG1THANG');
  assert.match(logUi.humanLogSummary(promotion), /TANG1THANG/);
  assert.equal(logUi.humanLogSummary({ ...promotion, action: 'delete_promotion' }), 'TANG1THANG · đã xóa mã giảm giá');
});

test('main activity result hides technical field names while raw detail support remains', () => {
  const log = { action: 'update', module: 'Kiosk', before: { total_paid: 0 }, after: { total_paid: 100000, payment_id: 4 } };
  assert.equal(logUi.importantChange(log), 'Đã cập nhật thông tin');
  assert.doesNotMatch(logUi.importantChange(log), /total paid|payment id|kiosk total paid/i);
});
