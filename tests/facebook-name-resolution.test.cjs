const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../api/facebook-id.js');

const REPORTED_URL = 'https://www.facebook.com/share/1DFjkXzV6n/?mibextid=wwXIfr';
const CLEAN_REPORTED_URL = 'https://www.facebook.com/share/1DFjkXzV6n/';
const REPORTED_ID = '100004296752387';

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

function facebookMeta({ id = '', name = '', canonicalUrl = '', backgroundCaptcha = false } = {}) {
  const encodedName = name === 'Võ Như Ý' ? 'V&#xf5; Nh&#x1b0; &#xdd;' : name;
  return [
    backgroundCaptcha ? '<script>window.__captchaModule = "recaptcha";</script>' : '',
    id ? `<meta property="al:android:url" content="fb://profile/${id}">` : '',
    name ? `<meta property="og:title" content="${encodedName}">` : '',
    canonicalUrl ? `<meta property="og:url" content="${canonicalUrl}">` : '',
  ].join('');
}

async function call(facebookUrl) {
  const res = {
    statusCode: 200,
    setHeader() {},
    status(value) { this.statusCode = value; return this; },
    json(value) { this.payload = value; return this; },
  };
  await handler({ method: 'POST', body: { facebook_url: facebookUrl } }, res);
  return res;
}

function providerFetch({ targetUrl, targetResponse, id = '', idProvider = 'vnfame', idName = '', byIdResponse } = {}) {
  return async (url) => {
    if (url === targetUrl) return targetResponse;
    if (url === `https://www.facebook.com/${id}` && byIdResponse) return byIdResponse;
    if (url === 'https://id.traodoisub.com/api.php') {
      return response({ json: idProvider === 'traodoisub' ? { id, name: idName } : { error: 'unresolved' } });
    }
    if (url === 'https://2uid.net') return response();
    if (url === 'https://lookup-id.com/') return response();
    if (url === 'https://vnfame.com/wp-admin/admin-ajax.php') {
      return response({
        json: idProvider === 'vnfame'
          ? { success: true, data: { fb_id: id, name: idName } }
          : { success: false },
      });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
}

test.afterEach(() => { delete global.fetch; });

test('reported Share URL accepts valid metadata even when Facebook HTML loads background CAPTCHA code', async () => {
  global.fetch = providerFetch({
    targetUrl: CLEAN_REPORTED_URL,
    targetResponse: response({
      url: 'https://www.facebook.com/nhuy.vo.14/?share_url=example',
      text: facebookMeta({
        id: REPORTED_ID,
        name: 'Võ Như Ý',
        canonicalUrl: 'https://www.facebook.com/nhuy.vo.14/',
        backgroundCaptcha: true,
      }),
    }),
    id: REPORTED_ID,
  });

  const result = await call(REPORTED_URL);
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.facebook_url, CLEAN_REPORTED_URL);
  assert.equal(result.payload.facebook_id, REPORTED_ID);
  assert.equal(result.payload.facebook_name, 'Võ Như Ý');
  assert.equal(result.payload.source, 'facebook_meta');
});

test('standard username URL obtains ID and Name from matching Facebook metadata', async () => {
  const targetUrl = 'https://www.facebook.com/example.user';
  global.fetch = providerFetch({
    targetUrl,
    targetResponse: response({
      url: targetUrl,
      text: facebookMeta({ id: '100001234567890', name: 'Example User', canonicalUrl: targetUrl }),
    }),
  });
  const result = await call(targetUrl);
  assert.equal(result.payload.facebook_id, '100001234567890');
  assert.equal(result.payload.facebook_name, 'Example User');
});

test('profile.php?id URL retains direct ID and matching editable Name payload', async () => {
  const targetUrl = 'https://www.facebook.com/profile.php?id=100001234567890';
  global.fetch = async (url) => {
    assert.equal(url, targetUrl);
    return response({ url: targetUrl, text: facebookMeta({ id: '100001234567890', name: 'Profile User' }) });
  };
  const result = await call(`${targetUrl}&ref=share`);
  assert.equal(result.payload.facebook_id, '100001234567890');
  assert.equal(result.payload.facebook_name, 'Profile User');
  assert.equal(result.payload.source, 'url_pattern');
});

test('provider ID without Name triggers bounded metadata lookup by resolved ID', async () => {
  const targetUrl = 'https://www.facebook.com/example.user';
  const id = '100001234567890';
  global.fetch = providerFetch({
    targetUrl,
    targetResponse: response({ url: targetUrl }),
    id,
    idProvider: 'vnfame',
    byIdResponse: response({
      url: 'https://www.facebook.com/example.user',
      text: facebookMeta({ id, name: 'Recovered Name' }),
    }),
  });
  const result = await call(targetUrl);
  assert.equal(result.payload.facebook_id, id);
  assert.equal(result.payload.facebook_name, 'Recovered Name');
  assert.equal(result.payload.source, 'vnfame');
});

test('unassociated or mismatched Name is never attached to a provider ID', async () => {
  const targetUrl = 'https://www.facebook.com/example.user';
  const id = '100001234567890';
  global.fetch = providerFetch({
    targetUrl,
    targetResponse: response({ url: targetUrl, text: facebookMeta({ name: 'Unassociated Name' }) }),
    id,
    idProvider: 'traodoisub',
    byIdResponse: response({
      url: 'https://www.facebook.com/different.user',
      text: facebookMeta({ id: '100009999999999', name: 'Different User' }),
    }),
  });
  const result = await call(targetUrl);
  assert.equal(result.payload.facebook_id, id);
  assert.equal(result.payload.source, 'traodoisub');
  assert.equal(Object.hasOwn(result.payload, 'facebook_name'), false);
});

test('ID success remains successful when no reliable Name is available', async () => {
  const targetUrl = 'https://www.facebook.com/example.user';
  const id = '100001234567890';
  global.fetch = providerFetch({
    targetUrl,
    targetResponse: response({ url: targetUrl }),
    id,
    idProvider: 'vnfame',
    byIdResponse: response({ url: `https://www.facebook.com/${id}` }),
  });
  const result = await call(targetUrl);
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.facebook_id, id);
  assert.equal(Object.hasOwn(result.payload, 'facebook_name'), false);
});
