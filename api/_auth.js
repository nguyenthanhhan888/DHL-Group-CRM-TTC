const { ALL_PERMISSIONS } = require('../shared/permissions.js');

const REQUIRED_ENV = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];

function assertServerConfig() {
  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
  if (!missing.length) return;
  throw httpError(500, `Thiếu biến môi trường: ${missing.join(', ')}`);
}

async function requireAuthenticatedUser(req) {
  assertServerConfig();
  const accessToken = bearerToken(req);
  if (!accessToken) throw httpError(401, 'Bạn cần đăng nhập.');
  const user = await authFetch('/auth/v1/user', { accessToken, useAnonKey: true });
  if (!user?.id) throw httpError(401, 'Phiên đăng nhập không hợp lệ.');
  return { user, accessToken };
}

async function requireWebAccess(req) {
  const auth = await requireAuthenticatedUser(req);
  const profile = normalizeAccessProfile(await userRpc('get_my_access_profile', {}, auth.accessToken));
  if (!profile?.user_id || profile.user_id !== auth.user.id) {
    throw httpError(403, 'Tài khoản không có quyền truy cập web.');
  }
  if (profile.status !== 'active' || profile.web_access_enabled !== true) {
    throw httpError(403, 'Tài khoản không có quyền truy cập web.');
  }
  if (!profile.is_system_admin && profile.permissions.length === 0) {
    throw httpError(403, 'Tài khoản không có quyền truy cập web.');
  }
  return { ...auth, profile };
}

async function requirePermission(req, permission) {
  if (!ALL_PERMISSIONS.includes(permission)) throw httpError(500, 'Permission backend không hợp lệ.');
  const actor = await requireWebAccess(req);
  if (!actor.profile.is_system_admin && !actor.profile.permissions.includes(permission)) {
    throw httpError(403, 'Bạn không có quyền thực hiện thao tác này.');
  }
  return actor;
}

async function requireSystemAdmin(req) {
  const actor = await requireWebAccess(req);
  if (!actor.profile.is_system_admin) throw httpError(403, 'Chỉ System Admin được thực hiện thao tác này.');
  return actor;
}

async function reauthenticateSystemAdmin(actor, password) {
  const normalizedPassword = String(password || '');
  if (!normalizedPassword) throw httpError(403, 'Xác nhận mật khẩu quản trị không thành công.');
  const authUser = await serviceFetch(`/auth/v1/admin/users/${encodeURIComponent(actor.user.id)}`);
  const email = authUser?.user?.email || authUser?.email || '';
  if (!email) throw httpError(403, 'Xác nhận mật khẩu quản trị không thành công.');

  let session;
  try {
    session = await authFetch('/auth/v1/token?grant_type=password', {
      method: 'POST',
      useAnonKey: true,
      body: { email, password: normalizedPassword },
    });
  } catch {
    throw httpError(403, 'Xác nhận mật khẩu quản trị không thành công.');
  }
  if (session?.user?.id !== actor.user.id || !session?.access_token) {
    throw httpError(403, 'Xác nhận mật khẩu quản trị không thành công.');
  }
  await authFetch('/auth/v1/logout?scope=local', {
    method: 'POST',
    useAnonKey: true,
    accessToken: session.access_token,
  }).catch(() => null);
  return true;
}

async function userRpc(name, body, accessToken) {
  return authFetch(`/rest/v1/rpc/${encodeURIComponent(name)}`, {
    method: 'POST',
    useAnonKey: true,
    accessToken,
    body,
  });
}

async function serviceFetch(path, options = {}) {
  return authFetch(path, { ...options, useAnonKey: false });
}

async function authFetch(path, {
  method = 'GET',
  body,
  accessToken = '',
  useAnonKey = false,
  headers = {},
  includeResponse = false,
} = {}) {
  assertServerConfig();
  const key = useAnonKey ? process.env.SUPABASE_ANON_KEY : process.env.SUPABASE_SERVICE_ROLE_KEY;
  const response = await fetch(`${baseUrl()}${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${accessToken || key}`,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text().catch(() => '');
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) {
    throw httpError(
      response.status >= 400 && response.status < 500 ? response.status : 500,
      data?.message || data?.msg || data?.error_description || response.statusText || 'Supabase request failed.',
      data?.code,
    );
  }
  return includeResponse ? { data, response } : data;
}

function normalizeAccessProfile(payload) {
  const source = payload?.profile && typeof payload.profile === 'object' ? payload.profile : payload || {};
  const rawPermissions = payload?.permissions || source.permissions || [];
  return {
    ...source,
    user_id: source.user_id || source.id || null,
    username: source.username || '',
    display_name: source.display_name || '',
    email: source.email || '',
    phone: source.phone || '',
    status: source.status || '',
    web_access_enabled: source.web_access_enabled === true,
    is_system_admin: source.is_system_admin === true,
    permissions: Array.isArray(rawPermissions)
      ? rawPermissions.filter((permission) => ALL_PERMISSIONS.includes(permission))
      : [],
  };
}

function bearerToken(req) {
  const header = req?.headers?.authorization || req?.headers?.Authorization || '';
  return String(header).match(/^Bearer\s+(.+)$/i)?.[1] || '';
}

function baseUrl() {
  return String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
}

function httpError(status, message, code = '') {
  const error = new Error(message);
  error.status = status;
  if (code) error.code = code;
  return error;
}

module.exports = {
  authFetch,
  bearerToken,
  httpError,
  normalizeAccessProfile,
  reauthenticateSystemAdmin,
  requireAuthenticatedUser,
  requirePermission,
  requireSystemAdmin,
  requireWebAccess,
  serviceFetch,
  userRpc,
};
