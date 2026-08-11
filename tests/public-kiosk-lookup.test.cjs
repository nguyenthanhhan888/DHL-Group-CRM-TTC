const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../api/public/kiosk-lookup.js');

const { differenceInDateOnlyDays, normalizeVietnamesePhone, phoneVariants, toPublicKiosk, rateLimitBuckets } = handler._test;

function response() {
  return { statusCode: 200, headers: {}, payload: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.payload = value; return this; } };
}

function withLookupEnvironment(callback) {
  const oldFetch = global.fetch;
  const oldUrl = process.env.SUPABASE_URL;
  const oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = 'https://project.example';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'server-secret';
  return Promise.resolve().then(callback).finally(() => {
    global.fetch = oldFetch;
    if (oldUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = oldKey;
    rateLimitBuckets.clear();
  });
}

test('Vietnamese phone normalization treats local and international formats equally', () => {
  for (const value of ['0912345678', '+84912345678', '84912345678', '0912 345 678', '0912-345-678']) {
    assert.equal(normalizeVietnamesePhone(value), '0912345678');
  }
  assert.deepEqual(phoneVariants('0912345678'), ['0912345678', '84912345678', '+84912345678']);
  assert.equal(normalizeVietnamesePhone('12345'), '');
});

test('active kiosk has a non-null remaining-days value', () => {
  const base = { facebook_name: 'Kiosk A', start_date: '2026-01-01', categories: { name: 'Ăn uống' }, business_types: { name: 'Nhà hàng' } };
  const kiosk = toPublicKiosk({ ...base, start_date: '2026-08-05', end_date: '2026-09-05' }, '2026-08-08');
  assert.equal(kiosk.status, 'Đang hoạt động');
  assert.equal(kiosk.remainingDays, 28);
  assert.equal(Number.isInteger(kiosk.remainingDays), true);
});

test('near-expiry kiosk returns the exact remaining days', () => {
  const kiosk = toPublicKiosk({ facebook_name: 'Kiosk A', start_date: '2026-08-01', end_date: '2026-08-20' }, '2026-08-08');
  assert.equal(kiosk.status, 'Sắp hết hạn');
  assert.equal(kiosk.remainingDays, 12);
});

test('expired kiosk has zero remaining days', () => {
  const kiosk = toPublicKiosk({ facebook_name: 'Kiosk A', start_date: '2026-07-01', end_date: '2026-08-07' }, '2026-08-08');
  assert.equal(kiosk.status, 'Đã hết hạn');
  assert.equal(kiosk.remainingDays, 0);
});

test('date-only calculation rejects invalid dates instead of producing NaN', () => {
  assert.equal(differenceInDateOnlyDays('2026-09-05', '2026-08-08'), 28);
  assert.equal(differenceInDateOnlyDays('2026-02-31', '2026-02-01'), null);
});

test('public Kiosk UI never renders null or undefined remaining days', async () => {
  const { renderPublicKiosk } = await import('../src/pages/RegisterPage.js');
  const normal = renderPublicKiosk({ name: 'A', status: 'Đang hoạt động', remainingDays: 28 });
  const malformed = renderPublicKiosk({ name: 'B', status: 'Đang hoạt động', remainingDays: null });
  assert.match(normal, /28 ngày/);
  assert.doesNotMatch(malformed, /(null|undefined) ngày/);
  assert.match(malformed, /Số ngày còn lại<\/dt><dd>—<\/dd>/);
});

test('valid anonymous lookup returns one kiosk and exposes only allowlisted fields', async () => withLookupEnvironment(async () => {
  global.fetch = async (url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer server-secret');
    if (String(url).includes('/customers?')) return { ok: true, json: async () => [{ id: 7, phone: 'secret' }] };
    return { ok: true, json: async () => [{ id: 99, customer_id: 7, facebook_id: 'raw-uid', note: 'secret', facebook_name: 'Kiosk A', start_date: '2026-01-01', end_date: '2099-12-31', auto_approve: true, categories: { name: 'Dịch vụ' }, business_types: { name: 'Spa' } }] };
  };
  const res = response();
  await handler({ method: 'POST', headers: { 'x-forwarded-for': '10.0.0.1' }, body: { phone: '+84912345678' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.kiosks.length, 1);
  assert.equal(Number.isInteger(res.payload.kiosks[0].remainingDays), true);
  assert.notEqual(res.payload.kiosks[0].remainingDays, null);
  assert.deepEqual(Object.keys(res.payload.kiosks[0]).sort(), ['autoApprove', 'businessType', 'category', 'expirationDate', 'name', 'remainingDays', 'startDate', 'status'].sort());
  assert.equal(JSON.stringify(res.payload).includes('raw-uid'), false);
  assert.equal(JSON.stringify(res.payload).includes('secret'), false);
}));

test('valid lookup returns all kiosks belonging to a matching customer', async () => withLookupEnvironment(async () => {
  global.fetch = async (url) => String(url).includes('/customers?')
    ? { ok: true, json: async () => [{ id: 7 }] }
    : { ok: true, json: async () => [
      { facebook_name: 'A', end_date: '2099-01-01' },
      { facebook_name: 'B', end_date: '2099-01-01' },
    ] };
  const res = response();
  await handler({ method: 'POST', headers: {}, body: { phone: '0912345678' } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload.kiosks.map((item) => item.name), ['A', 'B']);
  assert.equal(res.payload.kiosks.every((item) => Number.isInteger(item.remainingDays)), true);
}));

test('unknown and invalid phones use the same generic not-found wording', async () => withLookupEnvironment(async () => {
  global.fetch = async () => ({ ok: true, json: async () => [] });
  const invalid = response();
  await handler({ method: 'POST', headers: {}, body: { phone: 'abc' } }, invalid);
  const unknown = response();
  await handler({ method: 'POST', headers: {}, body: { phone: '0912345678' } }, unknown);
  assert.equal(invalid.statusCode, 400);
  assert.equal(unknown.statusCode, 404);
  assert.equal(invalid.payload.message, unknown.payload.message);
}));

test('only the public endpoint accepts anonymous POST; other API method protections remain intact', async () => {
  const res = response();
  await handler({ method: 'GET', headers: {} }, res);
  assert.equal(res.statusCode, 405);
});

test('public endpoint applies basic per-IP rate limiting', async () => withLookupEnvironment(async () => {
  global.fetch = async () => ({ ok: true, json: async () => [] });
  let res;
  for (let index = 0; index < 11; index += 1) {
    res = response();
    await handler({ method: 'POST', headers: { 'x-forwarded-for': '203.0.113.9' }, body: { phone: '0912345678' } }, res);
  }
  assert.equal(res.statusCode, 429);
  assert.equal(res.headers['Retry-After'], '60');
}));
