const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const userManagementHandler = require('../api/user-management.js');
const { PERMISSIONS, ALL_PERMISSIONS, ROUTE_PERMISSIONS } = require('../shared/permissions.js');

const ORIGINAL_ENV = { ...process.env };
const ACTOR_ID = '11111111-1111-4111-8111-111111111111';
const TARGET_ID = '22222222-2222-4222-8222-222222222222';

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

async function callHandler(body) {
  const res = mockResponse();
  await userManagementHandler({ method: 'POST', body, headers: { authorization: 'Bearer actor-token' } }, res);
  return res;
}

async function callStaffCompatibility() {
  const res = mockResponse();
  await userManagementHandler({
    method: 'GET',
    query: { compat: 'staff' },
    headers: { authorization: 'Bearer actor-token' },
  }, res);
  return res;
}

function accessProfile(overrides = {}) {
  return {
    user_id: ACTOR_ID,
    username: 'admin',
    display_name: 'System Admin',
    status: 'active',
    web_access_enabled: true,
    is_system_admin: true,
    permissions: [],
    ...overrides,
  };
}

function targetProfile(overrides = {}) {
  return {
    user_id: TARGET_ID,
    username: 'member',
    display_name: 'Member',
    email: 'member@example.com',
    phone: null,
    status: 'active',
    metadata: {},
    web_access_enabled: true,
    is_system_admin: false,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
    ...overrides,
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

test('canonical permission map contains all 24 active production permissions', () => {
  assert.equal(ALL_PERMISSIONS.length, 24);
  assert.equal(new Set(ALL_PERMISSIONS).size, 24);
  assert.equal(ROUTE_PERMISSIONS['user-management'], PERMISSIONS.USER_MANAGEMENT);
  assert.equal(ROUTE_PERMISSIONS['admin-ttc-wallets'], PERMISSIONS.WALLET);
});

test('locked session is rejected from sensitive API using current database access state', async () => {
  global.fetch = async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname === '/auth/v1/user') return response(200, { id: ACTOR_ID });
    if (parsed.pathname === '/rest/v1/rpc/get_my_access_profile') return response(200, accessProfile({ status: 'locked', web_access_enabled: false, is_system_admin: false, permissions: [PERMISSIONS.USER_MANAGEMENT] }));
    throw new Error(`Unexpected fetch: ${parsed.pathname}`);
  };
  const res = await callHandler({ action: 'list' });
  assert.equal(res.statusCode, 403);
});

test('one-permission user is denied an unrelated API permission', async () => {
  global.fetch = async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname === '/auth/v1/user') return response(200, { id: ACTOR_ID });
    if (parsed.pathname === '/rest/v1/rpc/get_my_access_profile') return response(200, accessProfile({ is_system_admin: false, permissions: [PERMISSIONS.DASHBOARD] }));
    throw new Error(`Unexpected fetch: ${parsed.pathname}`);
  };
  const res = await callHandler({ action: 'list' });
  assert.equal(res.statusCode, 403);
});

test('System Admin can list users without individual user_permissions rows', async () => {
  global.fetch = async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname === '/auth/v1/user') return response(200, { id: ACTOR_ID });
    if (parsed.pathname === '/rest/v1/rpc/get_my_access_profile') return response(200, accessProfile());
    if (parsed.pathname === '/rest/v1/user_profiles') return response(200, [targetProfile()], { 'content-range': '0-0/1' });
    if (parsed.pathname === '/rest/v1/user_permissions') return response(200, []);
    if (parsed.pathname === `/auth/v1/admin/users/${TARGET_ID}`) return response(200, { user: { id: TARGET_ID, last_sign_in_at: '2026-08-20T00:00:00Z' } });
    throw new Error(`Unexpected fetch: ${parsed.pathname}`);
  };
  const res = await callHandler({ action: 'list', page: 1, pageSize: 25 });
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.users.length, 1);
  assert.deepEqual(res.payload.users[0].permissions, []);
  assert.equal(res.payload.total, 1);
});

test('legacy GET /api/staff compatibility preserves listing contract for System Admin', async () => {
  const users = [targetProfile()];
  global.fetch = async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname === '/auth/v1/user') return response(200, { id: ACTOR_ID });
    if (parsed.pathname === '/rest/v1/rpc/get_my_access_profile') return response(200, accessProfile());
    if (parsed.pathname === '/rest/v1/user_profiles') {
      assert.equal(parsed.searchParams.get('select'), 'user_id,username,display_name,email,phone,status,web_access_enabled,is_system_admin,created_at');
      assert.equal(parsed.searchParams.get('order'), 'created_at.desc');
      assert.equal(parsed.searchParams.get('limit'), '100');
      return response(200, users);
    }
    throw new Error(`Unexpected fetch: ${parsed.pathname}`);
  };

  const res = await callStaffCompatibility();
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Cache-Control'], 'no-store');
  assert.deepEqual(res.payload, { ok: true, users, deprecated: true });
});

test('legacy staff compatibility still enforces user-management permission', async () => {
  global.fetch = async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname === '/auth/v1/user') return response(200, { id: ACTOR_ID });
    if (parsed.pathname === '/rest/v1/rpc/get_my_access_profile') {
      return response(200, accessProfile({ is_system_admin: false, permissions: [PERMISSIONS.DASHBOARD] }));
    }
    throw new Error(`Unexpected fetch: ${parsed.pathname}`);
  };

  const res = await callStaffCompatibility();
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.payload, { ok: false, message: 'Bạn không có quyền thực hiện thao tác này.' });
});

test('GET user-management without the staff rewrite marker keeps the existing POST-only contract', async () => {
  const res = mockResponse();
  await userManagementHandler({ method: 'GET', query: {}, headers: {} }, res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, 'POST');
  assert.deepEqual(res.payload, { ok: false, message: 'Chỉ hỗ trợ phương thức POST.' });
});

test('grant permissions performs authoritative sync and enables web access', async () => {
  const writes = [];
  global.fetch = createSensitiveFetch({
    target: targetProfile({ web_access_enabled: false }),
    existingPermissions: ['reports'],
    onWrite(entry) { writes.push(entry); },
  });
  const res = await callHandler({
    action: 'sync_permissions', userId: TARGET_ID,
    permissions: ['dashboard', 'customers'], adminPassword: 'admin-password', reason: 'Cấp quyền thử nghiệm',
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload.permissions, ['dashboard', 'customers']);
  const insert = writes.find((item) => item.path === '/rest/v1/user_permissions' && item.method === 'POST');
  assert.deepEqual(insert.body.map((row) => row.permission), ['dashboard', 'customers']);
  const profilePatch = writes.find((item) => item.path === '/rest/v1/user_profiles' && item.method === 'PATCH');
  assert.equal(profilePatch.body.web_access_enabled, true);
  assert.equal(profilePatch.body.web_access_updated_by, ACTOR_ID);
});

test('removing all permissions disables web access', async () => {
  const writes = [];
  global.fetch = createSensitiveFetch({ existingPermissions: ['dashboard'], onWrite(entry) { writes.push(entry); } });
  const res = await callHandler({
    action: 'sync_permissions', userId: TARGET_ID, permissions: [], adminPassword: 'admin-password', reason: 'Thu hồi toàn bộ',
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.webAccessEnabled, false);
  assert.equal(writes.some((item) => item.path === '/rest/v1/user_permissions' && item.method === 'POST'), false);
  assert.equal(writes.find((item) => item.path === '/rest/v1/user_profiles' && item.method === 'PATCH').body.web_access_enabled, false);
});

test('sensitive actions reject a wrong admin password before any protected write', async () => {
  const writes = [];
  global.fetch = async (url, options = {}) => {
    const parsed = new URL(url);
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : null;
    if (method !== 'GET') writes.push({ path: parsed.pathname, method, body });

    if (parsed.pathname === '/auth/v1/user') return response(200, { id: ACTOR_ID });
    if (parsed.pathname === '/rest/v1/rpc/get_my_access_profile') return response(200, accessProfile());
    if (parsed.pathname === `/auth/v1/admin/users/${ACTOR_ID}`) {
      return response(200, { user: { id: ACTOR_ID, email: 'internal-admin@example.invalid' } });
    }
    if (parsed.pathname === '/auth/v1/token') return response(400, { error_description: 'Invalid login credentials' });
    throw new Error(`Unexpected fetch: ${method} ${parsed.pathname}`);
  };

  const res = await callHandler({
    action: 'sync_permissions', userId: TARGET_ID, permissions: ['dashboard'],
    adminPassword: 'wrong-password', reason: 'Không được ghi dữ liệu',
  });
  assert.equal(res.statusCode, 403);
  assert.equal(res.payload.message, 'Xác nhận mật khẩu quản trị không thành công.');
  assert.equal(writes.some((item) => item.path === '/rest/v1/user_permissions'), false);
  assert.equal(writes.some((item) => item.path === '/rest/v1/user_profiles'), false);
  assert.equal(writes.filter((item) => item.path === '/auth/v1/token').length, 1);
});

test('profile update uses an explicit whitelist and ignores protected client fields', async () => {
  const writes = [];
  global.fetch = createSensitiveFetch({ onWrite(entry) { writes.push(entry); } });
  const res = await callHandler({
    action: 'update_profile', userId: TARGET_ID, displayName: 'Updated Member',
    isSystemAdmin: true, webAccessEnabled: true, status: 'locked',
  });
  assert.equal(res.statusCode, 200);
  const profilePatch = writes.find((item) => item.path === '/rest/v1/user_profiles' && item.method === 'PATCH');
  assert.equal(profilePatch.body.display_name, 'Updated Member');
  assert.equal(Object.hasOwn(profilePatch.body, 'is_system_admin'), false);
  assert.equal(Object.hasOwn(profilePatch.body, 'web_access_enabled'), false);
  assert.equal(Object.hasOwn(profilePatch.body, 'status'), false);
});

test('unknown or inactive permission is rejected before permission writes', async () => {
  const writes = [];
  global.fetch = createSensitiveFetch({ onWrite(entry) { writes.push(entry); } });
  const res = await callHandler({
    action: 'sync_permissions', userId: TARGET_ID, permissions: ['not-a-real-permission'],
    adminPassword: 'admin-password', reason: 'invalid test',
  });
  assert.equal(res.statusCode, 400);
  assert.equal(writes.some((item) => item.path === '/rest/v1/user_permissions'), false);
});

test('lock and unlock synchronize Auth ban and database web access without granting permissions', async () => {
  const lockWrites = [];
  global.fetch = createSensitiveFetch({ existingPermissions: ['dashboard'], onWrite(entry) { lockWrites.push(entry); } });
  const locked = await callHandler({ action: 'set_locked', userId: TARGET_ID, locked: true, adminPassword: 'admin-password', reason: 'Khóa kiểm thử' });
  assert.equal(locked.statusCode, 200);
  assert.equal(locked.payload.webAccessEnabled, false);
  assert.equal(lockWrites.find((item) => item.path === `/auth/v1/admin/users/${TARGET_ID}` && item.method === 'PUT').body.ban_duration, '876000h');

  const unlockWrites = [];
  global.fetch = createSensitiveFetch({ target: targetProfile({ status: 'locked', web_access_enabled: false }), existingPermissions: [], onWrite(entry) { unlockWrites.push(entry); } });
  const unlocked = await callHandler({ action: 'set_locked', userId: TARGET_ID, locked: false, adminPassword: 'admin-password', reason: 'Mở kiểm thử' });
  assert.equal(unlocked.statusCode, 200);
  assert.equal(unlocked.payload.webAccessEnabled, false);
  assert.equal(unlockWrites.find((item) => item.path === `/auth/v1/admin/users/${TARGET_ID}` && item.method === 'PUT').body.ban_duration, 'none');
});

test('System Admin target cannot be permission-modified or locked', async () => {
  global.fetch = createSensitiveFetch({ target: targetProfile({ is_system_admin: true }) });
  const permissionRes = await callHandler({ action: 'sync_permissions', userId: TARGET_ID, permissions: ['dashboard'], adminPassword: 'admin-password' });
  assert.equal(permissionRes.statusCode, 403);

  global.fetch = createSensitiveFetch({ target: targetProfile({ is_system_admin: true }) });
  const lockRes = await callHandler({ action: 'set_locked', userId: TARGET_ID, locked: true, adminPassword: 'admin-password', reason: 'test' });
  assert.equal(lockRes.statusCode, 403);
});

test('wallet adjustment reuses ledger RPC and preserves idempotency key', async () => {
  const writes = [];
  global.fetch = createSensitiveFetch({
    onWrite(entry) { writes.push(entry); },
    walletResult: { already_processed: true, ledger: { id: 99, balance_before: 10, balance_after: 15 } },
  });
  const res = await callHandler({
    action: 'adjust_wallet', userId: TARGET_ID, amount: 5, reason: 'Điều chỉnh',
    idempotencyKey: 'wallet:test:fixed', adminPassword: 'admin-password',
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.result.already_processed, true);
  const rpc = writes.find((item) => item.path === '/rest/v1/rpc/admin_post_wallet_ledger');
  assert.equal(rpc.body.idempotency_key_input, 'wallet:test:fixed');
  assert.equal(rpc.body.reason_input, 'Điều chỉnh');
});

test('password reset response and audit never contain plaintext passwords', async () => {
  const writes = [];
  global.fetch = createSensitiveFetch({ onWrite(entry) { writes.push(entry); } });
  const res = await callHandler({
    action: 'reset_password', userId: TARGET_ID, newPassword: 'new-secret-123',
    adminPassword: 'admin-password', reason: 'User yêu cầu',
  });
  assert.equal(res.statusCode, 200);
  assert.doesNotMatch(JSON.stringify(res.payload), /new-secret|admin-password/);
  const audit = writes.find((item) => item.path === '/rest/v1/audit_logs');
  assert.doesNotMatch(JSON.stringify(audit.body), /new-secret|admin-password/);
});

test('new authorization path has no legacy Reviewer checks or frontend service-role access', () => {
  const activeFiles = [
    'src/app.js', 'src/services/AuthService.js', 'src/services/StaffService.js',
    'src/pages/StaffPage.js', 'api/auth-account.js', 'api/user-management.js', 'api/_auth.js',
  ];
  const activeSource = activeFiles.map((file) => readFileSync(path.join(__dirname, '..', file), 'utf8')).join('\n');
  assert.doesNotMatch(activeSource, /user_roles|role_permissions|\breviewer\b/i);

  const frontendFiles = [
    'src/app.js', 'src/services/AuthService.js', 'src/services/StaffService.js',
    'src/pages/LoginPage.js', 'src/pages/StaffPage.js', 'src/constants/permissions.js',
  ];
  const frontendSource = frontendFiles.map((file) => readFileSync(path.join(__dirname, '..', file), 'utf8')).join('\n');
  assert.doesNotMatch(frontendSource, /SUPABASE_SERVICE_ROLE_KEY|service[_-]?role/i);
  assert.doesNotMatch(frontendSource, /\.from\(['"]user_permissions['"]\)\.(?:insert|update|delete)/);
  assert.doesNotMatch(frontendSource, /\.from\(['"]wallets['"]\)\.update/);
});

function createSensitiveFetch({
  target = targetProfile(), existingPermissions = [], onWrite = () => {}, walletResult = { already_processed: false },
} = {}) {
  return async (url, options = {}) => {
    const parsed = new URL(url);
    const pathName = parsed.pathname;
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : null;
    if (!['GET'].includes(method)) onWrite({ path: pathName, method, body });

    if (pathName === '/auth/v1/user') return response(200, { id: ACTOR_ID });
    if (pathName === '/rest/v1/rpc/get_my_access_profile') return response(200, accessProfile());
    if (pathName === `/auth/v1/admin/users/${ACTOR_ID}` && method === 'GET') return response(200, { user: { id: ACTOR_ID, email: 'internal-admin@example.invalid' } });
    if (pathName === '/auth/v1/token') return response(200, { access_token: 'reauth-token', refresh_token: 'reauth-refresh', user: { id: ACTOR_ID } });
    if (pathName === '/auth/v1/logout') return response(204, null);
    if (pathName === '/rest/v1/user_profiles' && method === 'GET') return response(200, [target]);
    if (pathName === '/rest/v1/app_permissions') return response(200, ALL_PERMISSIONS.map((permission) => ({ permission })));
    if (pathName === '/rest/v1/user_permissions' && method === 'GET') return response(200, existingPermissions.map((permission) => ({ permission })));
    if (pathName === '/rest/v1/user_permissions' && ['DELETE', 'POST'].includes(method)) return response(method === 'POST' ? 201 : 204, null);
    if (pathName === '/rest/v1/user_profiles' && method === 'PATCH') return response(204, null);
    if (pathName === '/rest/v1/audit_logs' && method === 'POST') return response(201, null);
    if (pathName === '/rest/v1/rpc/admin_post_wallet_ledger') return response(200, walletResult);
    if (pathName === `/auth/v1/admin/users/${TARGET_ID}` && method === 'GET') return response(200, { user: { id: TARGET_ID, last_sign_in_at: null } });
    if (pathName === `/auth/v1/admin/users/${TARGET_ID}` && method === 'PUT') return response(200, { user: { id: TARGET_ID } });
    throw new Error(`Unexpected fetch: ${method} ${pathName}`);
  };
}
