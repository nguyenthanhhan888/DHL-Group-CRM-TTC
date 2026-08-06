const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../api/facebook-id.js');

function mockResponse() {
  return {
    statusCode: 200,
    headers: {},
    payload: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(value) { this.statusCode = value; return this; },
    json(value) { this.payload = value; return this; },
  };
}

async function call(body, { method = 'POST' } = {}) {
  const res = mockResponse();
  await handler({ method, body }, res);
  return res;
}

test.afterEach(() => {
  delete global.fetch;
});

test('rejects non-POST requests', async () => {
  const res = await call({}, { method: 'GET' });
  assert.equal(res.statusCode, 405);
  assert.equal(res.payload.code, 'METHOD_NOT_ALLOWED');
  assert.equal(res.headers.Allow, 'POST');
});

test('rejects invalid URL and non-Facebook domain', async () => {
  let res = await call({ facebook_url: 'not-a-url' });
  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.code, 'INVALID_URL');

  res = await call({ facebook_url: 'https://facebook.com.evil.example/user' });
  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.code, 'INVALID_FACEBOOK_DOMAIN');
});

test('rejects malformed JSON', async () => {
  const res = await call('{not-json');
  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.code, 'INVALID_JSON');
});

test('returns Facebook ID for a valid URL using form-urlencoded upstream body', async () => {
  global.fetch = async (url, options) => {
    assert.equal(url, 'https://id.traodoisub.com/api.php');
    assert.equal(options.method, 'POST');
    assert.match(options.headers['Content-Type'], /^application\/x-www-form-urlencoded/);
    assert.equal(
      new URLSearchParams(options.body).get('link'),
      'https://www.facebook.com/example',
    );
    return { ok: true, json: async () => ({ id: 123456789 }) };
  };

  const res = await call({ facebook_url: 'https://www.facebook.com/example' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload, {
    success: true,
    facebook_id: '123456789',
    facebook_url: 'https://www.facebook.com/example',
  });
});

test('handles an unresolved Facebook ID', async () => {
  global.fetch = async () => ({ ok: true, json: async () => ({ error: 'not found' }) });
  const res = await call({ facebook_url: 'https://m.facebook.com/example' });
  assert.equal(res.statusCode, 422);
  assert.equal(res.payload.code, 'FACEBOOK_ID_NOT_FOUND');
});

test('handles upstream HTTP and invalid JSON errors', async () => {
  global.fetch = async () => ({ ok: false, status: 503 });
  let res = await call({ facebook_url: 'https://facebook.com/example' });
  assert.equal(res.statusCode, 502);
  assert.equal(res.payload.code, 'UPSTREAM_HTTP_ERROR');

  global.fetch = async () => ({ ok: true, json: async () => { throw new SyntaxError('bad'); } });
  res = await call({ facebook_url: 'https://facebook.com/example' });
  assert.equal(res.statusCode, 502);
  assert.equal(res.payload.code, 'UPSTREAM_INVALID_JSON');
});

test('handles timeout without retrying', async () => {
  let calls = 0;
  global.fetch = async (_url, options) => {
    calls += 1;
    await new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    });
  };

  const originalSetTimeout = global.setTimeout;
  global.setTimeout = (callback) => originalSetTimeout(callback, 1);
  try {
    const res = await call({ facebook_url: 'https://facebook.com/example' });
    assert.equal(res.statusCode, 504);
    assert.equal(res.payload.code, 'UPSTREAM_TIMEOUT');
    assert.equal(calls, 1);
  } finally {
    global.setTimeout = originalSetTimeout;
  }
});
