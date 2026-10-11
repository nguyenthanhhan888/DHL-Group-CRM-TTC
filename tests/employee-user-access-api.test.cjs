const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../api/user-management.js');

const ORIGINAL_ENV = { ...process.env };
const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const NEW_USER_ID = '33333333-3333-4333-8333-333333333333';
const EMPLOYEE = { id: 7, full_name: 'Nguyễn Văn A', phone: '0900000000', job_title: 'Vận hành', employment_status: 'active', archived_at: null, user_id: null };

function response(status, payload, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status >= 200 && status < 300 ? 'OK' : 'Error',
    headers: new Headers(headers),
    text: async () => payload == null ? '' : JSON.stringify(payload),
  };
}

function mockResponse() {
  return {
    statusCode: 200, payload: null, headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(value) { this.statusCode = value; return this; },
    json(value) { this.payload = value; return this; },
  };
}

async function call(body) {
  const res = mockResponse();
  await handler({ method: 'POST', body, headers: { authorization: 'Bearer actor-token' } }, res);
  return res;
}

function profile(overrides = {}) {
  return {
    user_id: USER_ID, username: 'nguyenvana', display_name: 'Nguyễn Văn A',
    email: null, phone: '0900000000', status: 'active', metadata: {},
    web_access_enabled: true, is_system_admin: false, created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z', ...overrides,
  };
}

function adminAccess(overrides = {}) {
  return {
    user_id: ADMIN_ID, username: 'admin', display_name: 'System Admin', status: 'active',
    web_access_enabled: true, is_system_admin: true, permissions: [], ...overrides,
  };
}

function authenticatedFetch(router, writes) {
  return async (url, options = {}) => {
    const parsed = new URL(url);
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : null;
    if (method !== 'GET') writes.push({ path: parsed.pathname, method, body, search: parsed.searchParams });
    if (parsed.pathname === '/auth/v1/user') return response(200, { id: ADMIN_ID });
    if (parsed.pathname === '/rest/v1/rpc/get_my_access_profile') return response(200, adminAccess());
    if (parsed.pathname === `/auth/v1/admin/users/${ADMIN_ID}` && method === 'GET') return response(200, { user: { id: ADMIN_ID, email: 'admin@internal.invalid' } });
    if (parsed.pathname === '/auth/v1/token') return response(200, { access_token: 'reauth-token', user: { id: ADMIN_ID } });
    if (parsed.pathname === '/auth/v1/logout') return response(204, null);
    const routed = await router({ parsed, method, body });
    if (routed) return routed;
    throw new Error(`Unexpected fetch: ${method} ${parsed.pathname}?${parsed.searchParams}`);
  };
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

test('granting CRM access creates one Website User and only links the existing Employee', async () => {
  const writes = [];
  global.fetch = authenticatedFetch(async ({ parsed, method, body }) => {
    if (parsed.pathname === '/rest/v1/employees' && method === 'GET') return response(200, [EMPLOYEE]);
    if (parsed.pathname === '/rest/v1/user_profiles' && method === 'GET') return response(200, []);
    if (parsed.pathname === '/auth/v1/admin/users' && method === 'POST') return response(200, { user: { id: NEW_USER_ID } });
    if (parsed.pathname === '/rest/v1/user_profiles' && method === 'POST') return response(201, null);
    if (parsed.pathname === '/rest/v1/employees' && method === 'PATCH') return response(200, [{ ...EMPLOYEE, user_id: NEW_USER_ID }]);
    if (parsed.pathname === '/rest/v1/audit_logs' && method === 'POST') return response(201, null);
    return null;
  }, writes);

  const res = await call({
    action: 'grant_employee_access', employeeId: EMPLOYEE.id, username: 'nguyenvana',
    password: 'initial-password', adminPassword: 'admin-password', reason: 'Cấp quyền theo phân công',
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.userId, NEW_USER_ID);
  assert.equal(res.payload.webAccessEnabled, false);
  assert.equal(writes.filter(item => item.path === '/rest/v1/employees' && item.method === 'POST').length, 0);
  assert.equal(writes.find(item => item.path === '/rest/v1/employees' && item.method === 'PATCH').body.user_id, NEW_USER_ID);
  const created = writes.find(item => item.path === '/rest/v1/user_profiles' && item.method === 'POST').body;
  assert.equal(created.is_system_admin, false);
  assert.equal(created.web_access_enabled, false);
});

test('link and unlink retain both Employee and Website User records', async () => {
  const linkWrites = [];
  global.fetch = authenticatedFetch(async ({ parsed, method }) => {
    if (parsed.pathname === '/rest/v1/employees' && method === 'GET') {
      return response(200, parsed.searchParams.get('id') ? [EMPLOYEE] : []);
    }
    if (parsed.pathname === '/rest/v1/user_profiles' && method === 'GET') return response(200, [profile()]);
    if (parsed.pathname === '/rest/v1/employees' && method === 'PATCH') return response(200, [{ ...EMPLOYEE, user_id: USER_ID }]);
    if (parsed.pathname === '/rest/v1/audit_logs' && method === 'POST') return response(201, null);
    return null;
  }, linkWrites);
  const linked = await call({ action: 'link_employee_user', employeeId: 7, userId: USER_ID, adminPassword: 'admin-password', reason: 'Liên kết tài khoản hiện có' });
  assert.equal(linked.statusCode, 200);
  assert.equal(linkWrites.some(item => item.method === 'POST' && item.path === '/rest/v1/employees'), false);

  const unlinkWrites = [];
  global.fetch = authenticatedFetch(async ({ parsed, method }) => {
    if (parsed.pathname === '/rest/v1/employees' && method === 'GET') return response(200, [{ ...EMPLOYEE, user_id: USER_ID }]);
    if (parsed.pathname === '/rest/v1/employees' && method === 'PATCH') return response(200, [{ ...EMPLOYEE, user_id: null }]);
    if (parsed.pathname === '/rest/v1/audit_logs' && method === 'POST') return response(201, null);
    return null;
  }, unlinkWrites);
  const unlinked = await call({ action: 'unlink_employee_user', userId: USER_ID, adminPassword: 'admin-password', reason: 'Thu hồi liên kết' });
  assert.equal(unlinked.statusCode, 200);
  assert.equal(unlinkWrites.find(item => item.path === '/rest/v1/employees' && item.method === 'PATCH').body.user_id, null);
  assert.equal(unlinkWrites.some(item => item.method === 'DELETE' && ['/rest/v1/employees', '/rest/v1/user_profiles'].includes(item.path)), false);
});

test('User Management returns linked Employee or null without forcing linkage', async () => {
  const writes = [];
  global.fetch = authenticatedFetch(async ({ parsed, method }) => {
    if (parsed.pathname === '/rest/v1/user_profiles') return response(200, [profile()], { 'content-range': '0-0/1' });
    if (parsed.pathname === '/rest/v1/user_permissions') return response(200, []);
    if (parsed.pathname === `/auth/v1/admin/users/${USER_ID}`) return response(200, { user: { id: USER_ID, last_sign_in_at: null } });
    if (parsed.pathname === '/rest/v1/employees') return response(200, [{ ...EMPLOYEE, user_id: USER_ID }]);
    return null;
  }, writes);
  const linked = await call({ action: 'list' });
  assert.equal(linked.statusCode, 200);
  assert.equal(linked.payload.users[0].employee.full_name, EMPLOYEE.full_name);

  global.fetch = authenticatedFetch(async ({ parsed }) => {
    if (parsed.pathname === '/rest/v1/user_profiles') return response(200, [profile()], { 'content-range': '0-0/1' });
    if (parsed.pathname === '/rest/v1/user_permissions') return response(200, []);
    if (parsed.pathname === `/auth/v1/admin/users/${USER_ID}`) return response(200, { user: { id: USER_ID } });
    if (parsed.pathname === '/rest/v1/employees') return response(200, []);
    return null;
  }, []);
  const unlinked = await call({ action: 'list' });
  assert.equal(unlinked.payload.users[0].employee, null);
});

test('ordinary Staff cannot call Employee access actions or self-escalate', async () => {
  const writes = [];
  global.fetch = async (url, options = {}) => {
    const parsed = new URL(url);
    const method = options.method || 'GET';
    if (method !== 'GET') writes.push({ path: parsed.pathname, method });
    if (parsed.pathname === '/auth/v1/user') return response(200, { id: ADMIN_ID });
    if (parsed.pathname === '/rest/v1/rpc/get_my_access_profile') {
      return response(200, adminAccess({ is_system_admin: false, permissions: ['user-management'] }));
    }
    throw new Error(`Unexpected fetch: ${method} ${parsed.pathname}`);
  };
  const res = await call({ action: 'link_employee_user', employeeId: 7, userId: USER_ID, adminPassword: 'irrelevant', reason: 'test' });
  assert.equal(res.statusCode, 403);
  assert.equal(writes.some(item => item.path === '/rest/v1/employees'), false);
});
