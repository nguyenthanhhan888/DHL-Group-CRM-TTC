const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const { displayOrderStatus } = require('../api/payos/_lifecycle');
const root = path.join(__dirname, '..');

test('completed business payment remains paid even when its checkout UI expired', () => {
  const order = { status: 'expired', expires_at: '2026-09-10T00:00:00Z' };
  assert.equal(displayOrderStatus(order, 'completed', Date.parse('2026-09-11T00:00:00Z')), 'paid');
});

test('a retained second transfer takes review priority over a paid display', () => {
  const order = { status: 'paid', reconciliation_required: true };
  assert.equal(displayOrderStatus(order, 'completed'), 'review_required');
});

test('regeneration checks provider state and never cancels the old PayOS order', () => {
  const lifecycle = readFileSync(path.join(root, 'api/payos/_lifecycle.js'), 'utf8');
  const registration = readFileSync(path.join(root, 'api/payos/create-registration-payment.js'), 'utf8');
  const renewal = readFileSync(path.join(root, 'api/public/renew-kiosk.js'), 'utf8');
  assert.match(lifecycle, /providerOrder/);
  assert.match(registration, /prepareCheckoutRetry\(payment\.id\)/);
  assert.match(renewal, /prepareCheckoutRetry\(payment\.id\)/);
  assert.doesNotMatch(lifecycle, /payment-requests\/.*cancel|method:\s*['"]POST['"]/);
});
