import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { renewalConfirmationCard, renewalPaymentCard } from '../src/pages/LookupPage.js';

const require = createRequire(import.meta.url);
const { publicRenewalPeriod } = require('../api/public/_renewal-period.js');

test('public renewal confirmation shows authoritative price, periods, and checkout action', () => {
  const html = renewalConfirmationCard({ kiosk: 'Kiosk A', pricePerMonth: 300000, endDate: '2026-08-14', renewalPeriods: { 1: { proposedExpiry: '2026-09-14' } } }, 0, 1);
  assert.match(html, /300\.000 VNĐ \/ tháng/);
  for (const months of [1, 3, 6, 12]) assert.match(html, new RegExp(`value="${months}"`));
  assert.match(html, /14\/09\/2026/);
  assert.match(html, /Tổng thanh toán/);
  assert.match(html, /Thanh toán qua PayOS/);
  assert.doesNotMatch(html, /discount|promotion|giảm giá/i);
});

test('legacy renewal payment renderer contains no inline QR or transfer data', () => {
  const html = renewalPaymentCard({ kiosk: 'Kiosk A', amount: 300000, qr: 'secret-qr', transfer: { accountNumber: 'secret-account' } });
  assert.match(html, /Đang chuyển đến PayOS/);
  assert.doesNotMatch(html, /secret-qr|secret-account|<img|Số tài khoản|chuyển khoản/i);
});

test('public renewal redirects and return handling polls only the read-only endpoint', async () => {
  const [page, service, status] = await Promise.all([
    readFile(new URL('../src/pages/LookupPage.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/services/PublicLookupService.js', import.meta.url), 'utf8'),
    readFile(new URL('../api/public/renewal-status.js', import.meta.url), 'utf8'),
  ]);
  assert.match(page, /window\.location\.assign\(data\.checkoutUrl\)/);
  assert.match(page, /attempt < 10/);
  assert.match(page, /setTimeout\(resolve, 3000\)/);
  assert.match(page, /Đang xác nhận thanh toán/);
  assert.match(page, /Bạn đã huỷ thanh toán/);
  assert.match(service, /\/api\/public\/renewal-status/);
  assert.doesNotMatch(status, /handle_payos_webhook|confirm_crm_payment|update\s+public\./i);
});

test('public renewal period preserves remaining time and inclusive calendar months', () => {
  assert.deepEqual(publicRenewalPeriod('2026-08-14', 1, '2026-08-12'), { startDate: '2026-08-15', proposedExpiry: '2026-09-14' });
  assert.deepEqual(publicRenewalPeriod('2026-08-01', 1, '2026-08-12'), { startDate: '2026-08-12', proposedExpiry: '2026-09-11' });
});
