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
  assert.equal(logUi.humanLogSummary(log), 'Nguyễn Thanh Hân đã gia hạn Kiosk ABC thêm 1 tháng.');
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
  assert.match(logUi.humanLogSummary(log), /450\.000.*Thanh toán #42/);
});

test('common audit fields have human-readable labels', () => {
  assert.equal(logUi.fieldLabel('start_date'), 'Ngày bắt đầu');
  assert.equal(logUi.fieldLabel('end_date'), 'Ngày hết hạn');
  assert.equal(logUi.fieldLabel('status'), 'Trạng thái');
  assert.equal(logUi.fieldLabel('phone'), 'Số điện thoại');
});
