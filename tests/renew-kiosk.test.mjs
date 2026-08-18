import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { calendarPeriodEnd, renewalStartDate } from '../src/components/RenewKioskForm.js';
import { formatCurrency } from '../src/utils/currency.js';
import { renewalBlockedMessage } from '../src/pages/LookupPage.js';

test('active Kiosk renewal starts one day after current expiry', () => {
  assert.equal(renewalStartDate('2026-08-31', new Date(2026, 7, 11)), '2026-09-01');
});

test('expired Kiosk renewal starts today', () => {
  assert.equal(renewalStartDate('2026-07-31', new Date(2026, 7, 11)), '2026-08-11');
});

test('public renewal blocked states use friendly Admin-support messages', () => {
  assert.equal(renewalBlockedMessage('PENDING_APPROVAL'), 'Kiosk đang chờ duyệt nên chưa thể gia hạn. Vui lòng liên hệ Admin để được hỗ trợ.');
  assert.equal(renewalBlockedMessage('INVALID_PRICE'), 'Hiện chưa xác định được giá gia hạn cho Kiosk này. Vui lòng liên hệ Admin để được hỗ trợ.');
  assert.doesNotMatch(renewalBlockedMessage('RENEWAL_CONFIG_UNAVAILABLE'), /token|RPC|PayOS|secret/i);
});

test('renewal end uses calendar months and inclusive end date', () => {
  assert.equal(calendarPeriodEnd('2026-08-18', 1), '2026-09-17');
  assert.equal(calendarPeriodEnd('2026-08-15', 1), '2026-09-14');
  assert.equal(calendarPeriodEnd('2026-08-15', 6), '2027-02-14');
  assert.equal(calendarPeriodEnd('2026-09-01', 1), '2026-09-30');
  assert.equal(calendarPeriodEnd('2026-01-31', 1), '2026-02-27');
  assert.equal(calendarPeriodEnd('2026-08-11', 3), '2026-11-10');
});

test('shared VND formatter is consistent', () => {
  assert.equal(formatCurrency(1000), '1.000 VNĐ');
  assert.equal(formatCurrency(1000000), '1.000.000 VNĐ');
});

test('manual and PayOS renewal paths remain separated', async () => {
  const source = await readFile(new URL('../src/components/RenewKioskForm.js', import.meta.url), 'utf8');
  const manualBody = source.match(/async function submitManual[\s\S]*?\n}\n\nasync function submitPayos/)?.[0] || '';
  const payosBody = source.match(/async function submitPayos[\s\S]*?\n}\n\nfunction updateCalculation/)?.[0] || '';
  assert.match(manualBody, /PaymentService\.manualRenewKiosk/);
  assert.doesNotMatch(manualBody, /PayosService|createCrmPayment|renewKiosk\(/);
  assert.match(payosBody, /PaymentService\.renewKiosk/);
  assert.match(payosBody, /PayosService\.createCrmPayment/);
});
