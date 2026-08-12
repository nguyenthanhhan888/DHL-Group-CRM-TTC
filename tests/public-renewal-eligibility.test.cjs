const test = require('node:test');
const assert = require('node:assert/strict');

const handler = require('../api/public/kiosk-lookup');
const SECRET = 'eligibility-renewal-secret-that-is-at-least-32-characters';

async function lookupKiosk({ status, price }) {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test';
  process.env.PUBLIC_RENEWAL_TOKEN_SECRET = SECRET;
  const originalFetch = global.fetch;
  const originalError = console.error;
  let calls = 0;
  global.fetch = async (url) => {
    calls += 1;
    if (String(url).includes('/customers?')) return { ok: true, json: async () => [{ id: 7 }] };
    if (String(url).includes('/kiosks?')) return { ok: true, json: async () => [{
      id: 11, facebook_name: 'Kiosk A', status,
      start_date: '2026-01-01', end_date: '2026-12-31',
      categories: { name: 'Dịch vụ' }, business_types: { name: 'Loại A', price_per_month: price },
    }] };
    return { ok: true, text: async () => '' };
  };
  console.error = () => {};
  let body;
  const req = { method: 'POST', body: { phone: '0888690346' } };
  const res = { setHeader() {}, status() { return this; }, json(value) { body = value; return value; } };
  try { await handler(req, res); } finally { global.fetch = originalFetch; console.error = originalError; }
  return { kiosk: body.kiosks[0], calls };
}

for (const status of ['active', 'warning', 'expired']) {
  test(`${status} Kiosk shows the renewal button and receives secure authorization`, async () => {
    const { kiosk, calls } = await lookupKiosk({ status, price: 100000 });
    assert.equal(kiosk.renewalButtonVisible, true);
    assert.equal(kiosk.renewalAvailable, true);
    assert.equal(kiosk.renewalBlockedReason, null);
    assert.equal(typeof kiosk.renewalToken, 'string');
    assert.equal(calls, 3);
  });
}

test('pending Kiosk shows the button without creating renewal authorization', async () => {
  const { kiosk, calls } = await lookupKiosk({ status: 'pending', price: 100000 });
  assert.equal(kiosk.renewalButtonVisible, true);
  assert.equal(kiosk.renewalAvailable, false);
  assert.equal(kiosk.renewalBlockedReason, 'PENDING_APPROVAL');
  assert.equal(kiosk.renewalToken, null);
  assert.equal(calls, 2);
});

for (const price of [0, null, 'not-a-price']) {
  test(`invalid price ${String(price)} shows the button without creating authorization or payment`, async () => {
    const { kiosk, calls } = await lookupKiosk({ status: 'active', price });
    assert.equal(kiosk.renewalButtonVisible, true);
    assert.equal(kiosk.renewalAvailable, false);
    assert.equal(kiosk.renewalBlockedReason, 'INVALID_PRICE');
    assert.equal(kiosk.renewalToken, null);
    assert.equal(calls, 2);
  });
}
