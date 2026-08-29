const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../api/auth-account.js');

const ORIGINAL_ENV = { ...process.env };

function mockResponse() {
  return {
    statusCode: 200, headers: {}, payload: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(value) { this.statusCode = value; return this; },
    json(value) { this.payload = value; return this; },
  };
}

async function call(body, { headers = {} } = {}) {
  const res = mockResponse();
  await handler({ method: 'POST', body, headers, socket: { remoteAddress: '127.0.0.1' } }, res);
  return res;
}

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status >= 200 && status < 300 ? 'OK' : 'Error',
    headers: new Headers(),
    text: async () => payload == null ? '' : JSON.stringify(payload),
  };
}

test.beforeEach(() => {
  process.env = {
    ...ORIGINAL_ENV,
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_ANON_KEY: 'anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  };
  handler.__test.loginAttempts.clear();
});

test.afterEach(() => {
  process.env = ORIGINAL_ENV;
  delete global.fetch;
});

test('admin username login normalizes lowercase and never exposes internal email', async () => {
  const requests = [];
  global.fetch = async (url, options = {}) => {
    const parsed = new URL(url);
    requests.push({ path: `${parsed.pathname}?${parsed.searchParams}`, options });
    if (parsed.pathname === '/rest/v1/user_profiles') {
      assert.equal(parsed.searchParams.get('username'), 'eq.admin');
      return response(200, [{ user_id: 'admin-id', username: 'admin', status: 'active', web_access_enabled: true, is_system_admin: true }]);
    }
    if (parsed.pathname === '/auth/v1/admin/users/admin-id') return response(200, { user: { id: 'admin-id', email: 'internal-admin@example.invalid' } });
    if (parsed.pathname === '/auth/v1/token') {
      assert.deepEqual(JSON.parse(options.body), { email: 'internal-admin@example.invalid', password: 'correct-password' });
      return response(200, { access_token: 'access-token', refresh_token: 'refresh-token', user: { id: 'admin-id', email: 'internal-admin@example.invalid' } });
    }
    if (parsed.pathname === '/rest/v1/rpc/get_my_access_profile') {
      return response(200, { user_id: 'admin-id', username: 'admin', status: 'active', web_access_enabled: true, is_system_admin: true, permissions: [] });
    }
    throw new Error(`Unexpected fetch: ${parsed.pathname}`);
  };

  const res = await call({ action: 'username_login', username: '  ADMIN  ', password: 'correct-password' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.ok, true);
  assert.equal(res.payload.session.accessToken, 'access-token');
  assert.doesNotMatch(JSON.stringify(res.payload), /internal-admin|example\.invalid|email/i);
  assert.equal(requests.some((item) => item.path.includes('user_roles')), false);
});

test('wrong username and wrong password return the same generic response', async () => {
  global.fetch = async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname === '/rest/v1/user_profiles') return response(200, []);
    throw new Error(`Unexpected fetch: ${parsed.pathname}`);
  };
  const wrongUsername = await call({ action: 'username_login', username: 'missing', password: 'anything' });

  handler.__test.loginAttempts.clear();
  global.fetch = async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname === '/rest/v1/user_profiles') return response(200, [{ user_id: 'user-id' }]);
    if (parsed.pathname === '/auth/v1/admin/users/user-id') return response(200, { user: { id: 'user-id', email: 'hidden@example.invalid' } });
    if (parsed.pathname === '/auth/v1/token') return response(400, { error: 'invalid_grant' });
    throw new Error(`Unexpected fetch: ${parsed.pathname}`);
  };
  const wrongPassword = await call({ action: 'username_login', username: 'member', password: 'wrong' });

  assert.equal(wrongUsername.statusCode, 401);
  assert.equal(wrongPassword.statusCode, 401);
  assert.deepEqual(wrongUsername.payload, wrongPassword.payload);
  assert.equal(wrongUsername.payload.message, handler.__test.GENERIC_LOGIN_ERROR);
});

test('locked or permissionless account is denied after valid password with a generic response', async () => {
  for (const access of [
    { status: 'locked', web_access_enabled: false, is_system_admin: false, permissions: ['dashboard'] },
    { status: 'active', web_access_enabled: true, is_system_admin: false, permissions: [] },
  ]) {
    handler.__test.loginAttempts.clear();
    let loggedOut = false;
    global.fetch = async (url) => {
      const parsed = new URL(url);
      if (parsed.pathname === '/rest/v1/user_profiles') return response(200, [{ user_id: 'user-id' }]);
      if (parsed.pathname === '/auth/v1/admin/users/user-id') return response(200, { user: { id: 'user-id', email: 'hidden@example.invalid' } });
      if (parsed.pathname === '/auth/v1/token') return response(200, { access_token: 'token', refresh_token: 'refresh', user: { id: 'user-id' } });
      if (parsed.pathname === '/rest/v1/rpc/get_my_access_profile') return response(200, { user_id: 'user-id', ...access });
      if (parsed.pathname === '/auth/v1/logout') { loggedOut = true; return response(204, null); }
      throw new Error(`Unexpected fetch: ${parsed.pathname}`);
    };
    const res = await call({ action: 'username_login', username: 'member', password: 'valid-password' });
    assert.equal(res.statusCode, 401);
    assert.equal(res.payload.message, handler.__test.GENERIC_LOGIN_ERROR);
    assert.equal(loggedOut, true);
  }
});

test('legacy email resolver is disabled and cannot disclose an auth email', async () => {
  const res = await call({ action: 'resolve_login', identifier: 'admin' });
  assert.equal(res.statusCode, 410);
  assert.deepEqual(res.payload, { ok: false, message: handler.__test.GENERIC_LOGIN_ERROR });
});
