const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../api/auth-account.js');

const ORIGINAL_ENV = { ...process.env };

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

async function call(body, { method = 'POST', headers = {} } = {}) {
  const res = mockResponse();
  await handler({ method, body, headers }, res);
  return res;
}

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status >= 200 && status < 300 ? 'OK' : 'Error',
    text: async () => JSON.stringify(payload),
  };
}

function missingUsernameResponse() {
  return response(400, {
    code: '42703',
    message: 'column user_profiles.username does not exist',
  });
}

test.beforeEach(() => {
  process.env = {
    ...ORIGINAL_ENV,
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_ANON_KEY: 'anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  };
});

test.afterEach(() => {
  process.env = ORIGINAL_ENV;
  delete global.fetch;
});

test('resolves phone login when live DB is missing user_profiles.username', async () => {
  global.fetch = async (url) => {
    const parsed = new URL(url);
    const path = `${parsed.pathname}?${parsed.searchParams.toString()}`;
    if (path.includes('/rest/v1/user_profiles') && path.includes('select=user_id%2Cusername')) {
      return missingUsernameResponse();
    }
    if (path.includes('/rest/v1/user_profiles') && path.includes('select=user_id%2Cemail%2Cphone%2Cmetadata')) {
      return response(200, [{
        user_id: 'user-1',
        email: null,
        phone: '0888640349',
        metadata: { username: 'hannt', auth_email: 'hannt@users.dhl.local' },
      }]);
    }
    throw new Error(`Unexpected fetch: ${path}`);
  };

  const res = await call({ action: 'resolve_login', identifier: '0888640349' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload, { ok: true, email: 'hannt@users.dhl.local' });
});

test('creates username account with metadata fallback when username column is not deployed yet', async () => {
  const profileBodies = [];

  global.fetch = async (url, options = {}) => {
    const parsed = new URL(url);
    const path = `${parsed.pathname}?${parsed.searchParams.toString()}`;
    const method = options.method || 'GET';

    if (method === 'GET' && path.includes('/rest/v1/user_profiles') && path.includes('select=user_id%2Cusername')) {
      return missingUsernameResponse();
    }
    if (method === 'GET' && path.includes('/rest/v1/user_profiles') && path.includes('metadata-%3E%3Eusername')) {
      return response(200, []);
    }
    if (method === 'POST' && parsed.pathname === '/auth/v1/admin/users') {
      return response(200, { user: { id: 'user-1', email: 'tester@users.dhl.local' } });
    }
    if (method === 'POST' && parsed.pathname === '/rest/v1/user_profiles') {
      const body = JSON.parse(options.body);
      profileBodies.push(body);
      if (Object.prototype.hasOwnProperty.call(body, 'username')) return missingUsernameResponse();
      return response(201, null);
    }
    if (method === 'POST' && parsed.pathname === '/rest/v1/wallets') {
      return response(201, null);
    }
    throw new Error(`Unexpected fetch: ${method} ${path}`);
  };

  const res = await call({
    action: 'create_user_account',
    displayName: 'Test User',
    username: 'tester',
    password: 'secret123',
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.ok, true);
  assert.equal(res.payload.username, 'tester');
  assert.equal(profileBodies.length, 2);
  assert.equal(profileBodies[0].username, 'tester');
  assert.equal(Object.prototype.hasOwnProperty.call(profileBodies[1], 'username'), false);
  assert.equal(profileBodies[1].metadata.username, 'tester');
});

test('admin profile update falls back when selecting user by id without username column', async () => {
  const patches = [];

  global.fetch = async (url, options = {}) => {
    const parsed = new URL(url);
    const path = `${parsed.pathname}?${parsed.searchParams.toString()}`;
    const method = options.method || 'GET';

    if (method === 'GET' && parsed.pathname === '/auth/v1/user') {
      return response(200, { id: 'admin-1' });
    }
    if (method === 'GET' && parsed.pathname === '/rest/v1/user_roles') {
      return response(200, [{ role: 'admin', is_active: true }]);
    }
    if (method === 'GET' && path.includes('/rest/v1/user_profiles') && path.includes('select=user_id%2Cusername')) {
      return missingUsernameResponse();
    }
    if (method === 'GET' && path.includes('/rest/v1/user_profiles') && path.includes('select=user_id%2Cdisplay_name')) {
      return response(200, [{
        user_id: 'user-1',
        display_name: 'Old Name',
        email: null,
        phone: null,
        status: 'active',
        metadata: { username: 'tester' },
      }]);
    }
    if (method === 'PATCH' && parsed.pathname === '/rest/v1/user_profiles') {
      patches.push(JSON.parse(options.body));
      return response(204, null);
    }
    throw new Error(`Unexpected fetch: ${method} ${path}`);
  };

  const res = await call({
    action: 'admin_update_user_profile',
    userId: 'user-1',
    displayName: 'New Name',
    metadataPatch: { admin_permissions: ['admin-ttc-users'] },
  }, {
    headers: { authorization: 'Bearer admin-session' },
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload, { ok: true });
  assert.equal(patches.length, 1);
  assert.equal(patches[0].display_name, 'New Name');
  assert.equal(patches[0].metadata.username, 'tester');
  assert.deepEqual(patches[0].metadata.admin_permissions, ['admin-ttc-users']);
});
