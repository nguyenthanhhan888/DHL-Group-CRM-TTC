import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  PaymentActionButtons,
  PaymentKioskList,
  PaymentProgress,
  PaymentStatusHero,
  PaymentSummaryCard,
} from '../src/components/PaymentExperience.js';

test('shared payment status system renders semantic states with inline SVG icons', () => {
  for (const status of ['checkout', 'pending', 'success', 'cancelled', 'warning']) {
    const html = PaymentStatusHero({ status, title: 'Trạng thái', description: 'Mô tả an toàn' });
    assert.match(html, new RegExp(`is-${status}`));
    assert.match(html, /<svg[^>]*aria-hidden="true"/);
    assert.doesNotMatch(html, /<img|https?:\/\//);
  }
  assert.match(PaymentProgress({ activeStep: 2 }), /aria-current="step"/);
  assert.match(PaymentProgress({ activeStep: 2 }), /aria-label="Tiến trình thanh toán"/);
});

test('payment summaries, kiosk rows, and actions escape customer-facing values', () => {
  const summary = PaymentSummaryCard([{ label: '<script>', value: '<b>unsafe</b>' }]);
  const kiosks = PaymentKioskList([{ name: '<img src=x>', businessType: '<Admin>', months: 1, totalAmount: 2000 }], { showAmounts: true });
  const actions = PaymentActionButtons([{ label: '<PayOS>', href: '#/lookup' }]);
  assert.doesNotMatch(`${summary}${kiosks}${actions}`, /<script>|<img src=x>|<Admin>|<PayOS>/);
  assert.match(kiosks, /2\.000 VNĐ/);
});

test('registration and renewal use the same payment component system for every result state', async () => {
  const [registration, renewal, css] = await Promise.all([
    readFile(new URL('../src/pages/RegisterPage.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/LookupPage.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/styles/app.css', import.meta.url), 'utf8'),
  ]);
  for (const component of ['PaymentStatusHero', 'PaymentSummaryCard', 'PaymentActionButtons', 'PaymentProgress']) {
    assert.match(registration, new RegExp(component));
    assert.match(renewal, new RegExp(component));
  }
  assert.match(registration, /PaymentKioskList/);
  assert.match(registration, /Thanh toán qua PayOS/);
  assert.match(renewal, /Thanh toán qua PayOS/);
  assert.match(css, /@media\(max-width:620px\)[\s\S]*\.payment-actions/);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)/);
});
