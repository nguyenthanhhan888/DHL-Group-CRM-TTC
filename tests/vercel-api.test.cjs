const test = require('node:test');
const assert = require('node:assert/strict');

const authAccount = require('../api/auth-account.js');
const staff = require('../api/staff.js');
const createPayment = require('../api/payos/create-payment.js');
const createRegistrationPayment = require('../api/payos/create-registration-payment.js');
const webhook = require('../api/payos/webhook.js');
const kioskLookup = require('../api/public/kiosk-lookup.js');

function response() {
  return {
    statusCode: 200,
    headers: {},
    payload: undefined,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.payload = value; return this; },
  };
}

test('Vercel API handlers reject unsupported methods', async () => {
  for (const [handler, method] of [
    [authAccount, 'GET'],
    [staff, 'POST'],
    [createPayment, 'GET'],
    [createRegistrationPayment, 'GET'],
    [webhook, 'GET'],
    [kioskLookup, 'GET'],
  ]) {
    const res = response();
    await handler({ method, headers: {} }, res);
    assert.equal(res.statusCode, 405);
  }
});

test('payOS checkout APIs fail closed while PAYOS_ENABLED is false', async () => {
  const previous = process.env.PAYOS_ENABLED;
  process.env.PAYOS_ENABLED = 'false';
  try {
    for (const handler of [createPayment, createRegistrationPayment]) {
      const res = response();
      await handler({ method: 'POST', headers: {}, body: {} }, res);
      assert.equal(res.statusCode, 503);
      assert.equal(res.payload.code, 'PAYOS_DISABLED');
    }
  } finally {
    if (previous === undefined) delete process.env.PAYOS_ENABLED;
    else process.env.PAYOS_ENABLED = previous;
  }
});
