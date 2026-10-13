const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../api/facebook-id.js');

const PROFILE_URL = 'https://www.facebook.com/example';

function response({ status = 200, url = '', text = '', json = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    headers: {},
    text: async () => text,
    json: async () => json,
  };
}

function providerFetch(overrides = {}) {
  const neutral = {
    facebook: () => response({ url: PROFILE_URL }),
    traodoisub: () => response({ json: { error: 'unresolved' } }),
    twoUidLanding: () => response(),
    twoUidConvert: () => response({ json: { success: 422 } }),
    lookupId: () => response(),
    vnfame: () => response({ json: { success: false } }),
  };
  const providers = { ...neutral, ...overrides };
  return async (url, options = {}) => {
    if (url === PROFILE_URL) return providers.facebook(url, options);
    if (url === 'https://id.traodoisub.com/api.php') return providers.traodoisub(url, options);
    if (url === 'https://2uid.net') return providers.twoUidLanding(url, options);
    if (url === 'https://2uid.net/api/convert') return providers.twoUidConvert(url, options);
    if (url === 'https://lookup-id.com/') return providers.lookupId(url, options);
    if (url === 'https://vnfame.com/wp-admin/admin-ajax.php') return providers.vnfame(url, options);
    throw new Error(`Unexpected provider URL: ${url}`);
  };
}

async function call(facebookUrl = PROFILE_URL) {
  const res = {
    statusCode: 200,
    setHeader() {},
    status(value) { this.statusCode = value; return this; },
    json(value) { this.payload = value; return this; },
  };
  await handler({ method: 'POST', body: { facebook_url: facebookUrl } }, res);
  return res;
}

test.afterEach(() => { delete global.fetch; });

test('malformed, foreign-domain and unsupported content URLs are invalid before provider calls', async () => {
  global.fetch = async () => { throw new Error('provider must not be called'); };
  for (const url of [
    'not-a-url',
    'https://facebook.com.evil.example/example',
    'https://facebook.com/groups/123456789',
    'https://facebook.com/example/posts/987654321',
    'https://facebook.com/watch/?v=987654321',
  ]) {
    const result = await call(url);
    assert.equal(result.statusCode, 400, url);
    assert.equal(result.payload.code, 'INVALID_FACEBOOK_URL', url);
  }
});

test('profile-specific Facebook 404 and 410 are reliable not-found evidence', async () => {
  for (const status of [404, 410]) {
    global.fetch = providerFetch({
      facebook: () => response({ status, url: PROFILE_URL }),
    });
    const result = await call();
    assert.equal(result.statusCode, 404);
    assert.equal(result.payload.code, 'FACEBOOK_PROFILE_NOT_FOUND');
  }

  const numericUrl = 'https://www.facebook.com/100001234567890';
  global.fetch = async () => response({ status: 410, url: numericUrl });
  const numericResult = await call(numericUrl);
  assert.equal(numericResult.payload.code, 'FACEBOOK_PROFILE_NOT_FOUND');
});

test('a third-party provider endpoint 404 is inconclusive, not profile deletion', async () => {
  global.fetch = providerFetch({
    traodoisub: () => response({ status: 404, url: 'https://id.traodoisub.com/api.php' }),
  });
  const result = await call();
  assert.equal(result.statusCode, 422);
  assert.equal(result.payload.code, 'FACEBOOK_LOOKUP_INCONCLUSIVE');
});

test('a reliable Facebook unavailable page is profile-not-found evidence', async () => {
  global.fetch = providerFetch({
    facebook: () => response({
      url: PROFILE_URL,
      text: '<title>Page not found</title><main>The link you followed may be broken, or the page may have been removed.</main>',
    }),
  });
  const result = await call();
  assert.equal(result.payload.code, 'FACEBOOK_PROFILE_NOT_FOUND');
});

test('CAPTCHA from every lookup source is provider-blocked', async () => {
  global.fetch = providerFetch({
    facebook: () => response({ url: PROFILE_URL, text: '<div>reCAPTCHA challenge</div>' }),
    traodoisub: () => response({ json: { code: 403, error: 'captcha' } }),
    twoUidLanding: () => response({ text: "X-CSRF-TOKEN', 'token'" }),
    twoUidConvert: () => response({ json: { error: 'captcha' } }),
    lookupId: () => response({ text: '<div>captcha</div>' }),
    vnfame: () => response({ json: { success: false, message: 'recaptcha' } }),
  });
  const result = await call();
  assert.equal(result.statusCode, 503);
  assert.equal(result.payload.code, 'FACEBOOK_ID_PROVIDER_BLOCKED');
});

test('CAPTCHA mixed with inconclusive evidence stays inconclusive', async () => {
  global.fetch = providerFetch({
    traodoisub: () => response({ json: { code: 403, error: 'captcha' } }),
  });
  const result = await call();
  assert.equal(result.payload.code, 'FACEBOOK_LOOKUP_INCONCLUSIVE');
});

test('reliable profile-not-found evidence outranks provider CAPTCHA', async () => {
  global.fetch = providerFetch({
    facebook: () => response({ status: 410, url: PROFILE_URL }),
    traodoisub: () => response({ json: { code: 403, error: 'captcha' } }),
  });
  const result = await call();
  assert.equal(result.payload.code, 'FACEBOOK_PROFILE_NOT_FOUND');
});

test('a successful provider identity outranks another provider CAPTCHA', async () => {
  global.fetch = providerFetch({
    facebook: () => response({ url: PROFILE_URL, text: '<div>captcha</div>' }),
    traodoisub: () => response({ json: { id: '100001234567890', name: 'Example User' } }),
  });
  const result = await call();
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.facebook_id, '100001234567890');
  assert.equal(result.payload.facebook_name, 'Example User');
});

test('Facebook login redirects and generic HTTP-200 error HTML remain inconclusive', async () => {
  global.fetch = providerFetch({
    facebook: () => response({ url: 'https://www.facebook.com/login/?next=%2Fexample', text: '<title>Log in to Facebook</title>' }),
  });
  assert.equal((await call()).payload.code, 'FACEBOOK_LOOKUP_INCONCLUSIVE');

  global.fetch = providerFetch({
    facebook: () => response({
      url: PROFILE_URL,
      text: '<title>Private Example | Facebook</title><main>Log in to see photos and updates from friends.</main>',
    }),
  });
  assert.equal((await call()).payload.code, 'FACEBOOK_LOOKUP_INCONCLUSIVE');

  global.fetch = providerFetch({
    facebook: () => response({ url: PROFILE_URL, text: '<title>Something went wrong</title><main>Please try again later.</main>' }),
    lookupId: () => response({ text: '<h1>Internal provider error</h1>' }),
  });
  assert.equal((await call()).payload.code, 'FACEBOOK_LOOKUP_INCONCLUSIVE');
});

test('uniform timeout and network failures preserve infrastructure classifications', async () => {
  global.fetch = async () => { const error = new Error('timeout'); error.name = 'AbortError'; throw error; };
  assert.equal((await call()).payload.code, 'UPSTREAM_TIMEOUT');

  global.fetch = async () => { throw new TypeError('network failed'); };
  assert.equal((await call()).payload.code, 'UPSTREAM_REQUEST_FAILED');
});
