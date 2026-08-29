const { PERMISSIONS } = require('../shared/permissions.js');
const {
  httpError,
  reauthenticateSystemAdmin,
  requirePermission,
  requireSystemAdmin,
  serviceFetch,
  userRpc,
} = require('./_auth.js');

const USER_ID_PATTERN = /^[0-9a-f-]{36}$/i;
const PHONE_PATTERN = /^\+?[0-9 .()-]{9,20}$/;

module.exports = async function userManagementHandler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, message: 'Chỉ hỗ trợ phương thức POST.' });
  }

  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const action = String(body.action || '');
    if (action === 'list') return send(res, await listUsers(req, body));
    if (action === 'detail') return send(res, await getUserDetail(req, body));
    if (action === 'update_profile') return send(res, await updateProfile(req, body));
    if (action === 'sync_permissions') return send(res, await syncPermissions(req, body));
    if (action === 'adjust_wallet') return send(res, await adjustWallet(req, body));
    if (action === 'wallet_ledger') return send(res, await listWalletLedger(req, body));
    if (action === 'set_locked') return send(res, await setLocked(req, body));
    if (action === 'reset_password') return send(res, await resetPassword(req, body));
    return res.status(400).json({ ok: false, message: 'Thao tác không hợp lệ.' });
  } catch (error) {
    return res.status(error.status || 500).json({
      ok: false,
      message: error.message || 'Không thể xử lý Quản lý người dùng.',
    });
  }
};

async function listUsers(req, body) {
  await requirePermission(req, PERMISSIONS.USER_MANAGEMENT);
  const { page, pageSize, from, to } = pagination(body);
  const params = new URLSearchParams({
    select: 'user_id,username,display_name,email,phone,status,metadata,web_access_enabled,is_system_admin,web_access_updated_at,created_at,updated_at,wallets(balance,total_earned,total_spent),user_facebook_accounts(id,facebook_id,facebook_id_status,is_primary,facebook_url_original)',
    order: 'created_at.desc',
    offset: String(from),
    limit: String(to - from + 1),
  });
  const search = safeSearch(body.search);
  if (search) params.set('or', `(username.ilike.*${search}*,display_name.ilike.*${search}*,email.ilike.*${search}*,phone.ilike.*${search}*)`);

  const result = await serviceFetch(`/rest/v1/user_profiles?${params.toString()}`, {
    headers: { Prefer: 'count=exact' },
    includeResponse: true,
  });
  const users = Array.isArray(result.data) ? result.data : [];
  const permissionsByUser = await permissionsForUsers(users.map((user) => user.user_id));
  const authByUser = await authDetailsForUsers(users.map((user) => user.user_id));
  return {
    ok: true,
    users: users.map((user) => serializeUser(user, permissionsByUser.get(user.user_id), authByUser.get(user.user_id))),
    page,
    pageSize,
    total: contentRangeTotal(result.response.headers.get('content-range'), users.length),
  };
}

async function getUserDetail(req, body) {
  await requirePermission(req, PERMISSIONS.USER_MANAGEMENT);
  const userId = requiredUserId(body.userId);
  const target = await getProfile(userId, true);
  if (!target) throw httpError(404, 'Không tìm thấy người dùng.');
  const [permissionRows, authUser] = await Promise.all([
    getDirectPermissions(userId),
    getAuthUser(userId),
  ]);
  return { ok: true, user: serializeUser(target, permissionRows, authUser), permissionCatalog: await activePermissions() };
}

async function updateProfile(req, body) {
  const actor = await requirePermission(req, PERMISSIONS.USER_MANAGEMENT);
  const userId = requiredUserId(body.userId);
  const before = await getProfile(userId, true);
  if (!before) throw httpError(404, 'Không tìm thấy người dùng.');
  if (before.is_system_admin && (!actor.profile.is_system_admin || actor.user.id !== userId)) {
    throw httpError(403, 'Không thể chỉnh sửa System Admin.');
  }

  const patch = {};
  if (has(body, 'displayName')) patch.display_name = nullableText(body.displayName, 100);
  if (has(body, 'email')) {
    const email = nullableText(body.email, 254)?.toLowerCase() || null;
    if (email && !/^\S+@\S+\.\S+$/.test(email)) throw httpError(400, 'Email không hợp lệ.');
    patch.email = email;
  }
  if (has(body, 'phone')) {
    const phone = nullableText(body.phone, 40);
    if (phone && !PHONE_PATTERN.test(phone)) throw httpError(400, 'Số điện thoại không hợp lệ.');
    patch.phone = phone;
  }

  const metadata = before.metadata && typeof before.metadata === 'object' ? { ...before.metadata } : {};
  if (has(body, 'tier')) metadata.tier = allowedTier(body.tier);
  if (has(body, 'creditLimit')) metadata.credit_limit = nonNegativeNumber(body.creditLimit, 'Hạn mức');
  if (has(body, 'tier') || has(body, 'creditLimit')) patch.metadata = metadata;
  if (!Object.keys(patch).length && !has(body, 'facebookId')) throw httpError(400, 'Không có thông tin hợp lệ để cập nhật.');
  if (Object.keys(patch).length) {
    patch.updated_at = new Date().toISOString();
    await serviceFetch(`/rest/v1/user_profiles?user_id=eq.${encodeURIComponent(userId)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: patch,
    });
  }
  if (has(body, 'facebookId')) await updateFacebookId(userId, body.facebookId, actor.user.id, before.user_facebook_accounts);

  const after = await getProfile(userId, true);
  await writeAudit(actor, 'update_profile', userId, auditUser(before), auditUser(after), nullableText(body.reason, 500) || 'Cập nhật thông tin người dùng');
  return { ok: true, user: serializeUser(after, await getDirectPermissions(userId), await getAuthUser(userId)) };
}

async function syncPermissions(req, body) {
  const actor = await requireSystemAdmin(req);
  await reauthenticateSystemAdmin(actor, body.adminPassword);
  const userId = requiredUserId(body.userId);
  if (actor.user.id === userId) throw httpError(403, 'Không thể tự cấp quyền cho chính mình.');
  const target = await getProfile(userId, false);
  if (!target) throw httpError(404, 'Không tìm thấy người dùng.');
  if (target.is_system_admin) throw httpError(403, 'Không thể thay đổi quyền System Admin.');

  const requested = uniqueStrings(body.permissions);
  const catalog = await activePermissions();
  const activeSet = new Set(catalog);
  if (requested.some((permission) => !activeSet.has(permission))) throw httpError(400, 'Danh sách quyền chứa permission không hợp lệ hoặc đã tắt.');
  const beforePermissions = await getDirectPermissions(userId);

  await replacePermissions(userId, requested, actor.user.id, beforePermissions);
  const webAccess = requested.length > 0;
  const now = new Date().toISOString();
  await serviceFetch(`/rest/v1/user_profiles?user_id=eq.${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: {
      web_access_enabled: webAccess,
      web_access_updated_at: now,
      web_access_updated_by: actor.user.id,
      updated_at: now,
    },
  });
  await writeAudit(actor, 'sync_permissions', userId,
    { permissions: beforePermissions, web_access_enabled: target.web_access_enabled },
    { permissions: requested, web_access_enabled: webAccess },
    nullableText(body.reason, 500) || 'Cập nhật quyền truy cập web');
  return { ok: true, permissions: requested, webAccessEnabled: webAccess };
}

async function adjustWallet(req, body) {
  const actor = await requireSystemAdmin(req);
  await reauthenticateSystemAdmin(actor, body.adminPassword);
  const userId = requiredUserId(body.userId);
  const target = await getProfile(userId, false);
  if (!target) throw httpError(404, 'Không tìm thấy người dùng.');
  if (target.is_system_admin) throw httpError(403, 'Không thể sửa ví System Admin.');
  const amount = nonZeroNumber(body.amount, 'Số xu');
  const reason = requiredText(body.reason, 500, 'Lý do');
  const idempotencyKey = requiredText(body.idempotencyKey, 180, 'Idempotency key');
  const result = await userRpc('admin_post_wallet_ledger', {
    wallet_user_id_input: userId,
    amount_input: amount,
    transaction_type_input: 'admin_adjustment',
    related_table_input: null,
    related_id_input: null,
    idempotency_key_input: idempotencyKey,
    description_input: nullableText(body.description, 500),
    reason_input: reason,
    metadata_input: { source: 'unified_user_management' },
  }, actor.accessToken);
  return { ok: true, result };
}

async function listWalletLedger(req, body) {
  await requirePermission(req, PERMISSIONS.USER_MANAGEMENT);
  const userId = requiredUserId(body.userId);
  const { page, pageSize, from, to } = pagination(body);
  const params = new URLSearchParams({
    select: 'id,wallet_user_id,actor_id,actor_type,transaction_type,amount,balance_before,balance_after,description,reason,idempotency_key,created_at',
    wallet_user_id: `eq.${userId}`,
    order: 'created_at.desc,id.desc',
    offset: String(from),
    limit: String(to - from + 1),
  });
  const result = await serviceFetch(`/rest/v1/wallet_ledger?${params.toString()}`, {
    headers: { Prefer: 'count=exact' },
    includeResponse: true,
  });
  const rows = Array.isArray(result.data) ? result.data : [];
  return { ok: true, rows, page, pageSize, total: contentRangeTotal(result.response.headers.get('content-range'), rows.length) };
}

async function setLocked(req, body) {
  const actor = await requireSystemAdmin(req);
  await reauthenticateSystemAdmin(actor, body.adminPassword);
  const userId = requiredUserId(body.userId);
  const target = await getProfile(userId, false);
  if (!target) throw httpError(404, 'Không tìm thấy người dùng.');
  if (target.is_system_admin) throw httpError(403, 'Không thể khóa hoặc mở khóa System Admin.');
  const locked = body.locked === true;
  const permissionCount = (await getDirectPermissions(userId)).length;
  const next = {
    status: locked ? 'locked' : 'active',
    web_access_enabled: locked ? false : permissionCount > 0,
    updated_at: new Date().toISOString(),
  };
  await serviceFetch(`/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: 'PUT',
    body: { ban_duration: locked ? '876000h' : 'none' },
  });
  try {
    await serviceFetch(`/rest/v1/user_profiles?user_id=eq.${encodeURIComponent(userId)}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: next,
    });
  } catch (error) {
    await serviceFetch(`/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
      method: 'PUT', body: { ban_duration: locked ? 'none' : '876000h' },
    }).catch(() => null);
    throw error;
  }
  await writeAudit(actor, locked ? 'lock_user' : 'unlock_user', userId,
    { status: target.status, web_access_enabled: target.web_access_enabled }, next,
    requiredText(body.reason, 500, 'Lý do'));
  return { ok: true, status: next.status, webAccessEnabled: next.web_access_enabled };
}

async function resetPassword(req, body) {
  const actor = await requireSystemAdmin(req);
  await reauthenticateSystemAdmin(actor, body.adminPassword);
  const userId = requiredUserId(body.userId);
  const target = await getProfile(userId, false);
  if (!target) throw httpError(404, 'Không tìm thấy người dùng.');
  if (target.is_system_admin) throw httpError(403, 'Không thể đặt lại mật khẩu System Admin từ trang này.');
  const newPassword = String(body.newPassword || '');
  if (newPassword.length < 8) throw httpError(400, 'Mật khẩu mới cần ít nhất 8 ký tự.');
  await serviceFetch(`/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: 'PUT', body: { password: newPassword },
  });
  await writeAudit(actor, 'reset_password', userId, null, { password_reset: true }, requiredText(body.reason, 500, 'Lý do'));
  return { ok: true };
}

async function getProfile(userId, includeRelations) {
  const select = includeRelations
    ? '*,wallets(balance,total_earned,total_spent),user_facebook_accounts(id,facebook_id,facebook_id_status,is_primary,facebook_url_original)'
    : 'user_id,username,display_name,email,phone,status,metadata,web_access_enabled,is_system_admin,web_access_updated_at,created_at,updated_at';
  const params = new URLSearchParams({ select, user_id: `eq.${userId}`, limit: '1' });
  const rows = await serviceFetch(`/rest/v1/user_profiles?${params.toString()}`);
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function getDirectPermissions(userId) {
  const params = new URLSearchParams({ select: 'permission', user_id: `eq.${userId}`, order: 'permission.asc' });
  const rows = await serviceFetch(`/rest/v1/user_permissions?${params.toString()}`);
  return (rows || []).map((row) => row.permission);
}

async function activePermissions() {
  const params = new URLSearchParams({ select: 'permission', is_active: 'eq.true', order: 'permission.asc' });
  const rows = await serviceFetch(`/rest/v1/app_permissions?${params.toString()}`);
  return (rows || []).map((row) => row.permission);
}

async function permissionsForUsers(userIds) {
  const result = new Map(userIds.map((id) => [id, []]));
  if (!userIds.length) return result;
  const params = new URLSearchParams({ select: 'user_id,permission', user_id: `in.(${userIds.join(',')})`, order: 'permission.asc' });
  const rows = await serviceFetch(`/rest/v1/user_permissions?${params.toString()}`);
  for (const row of rows || []) result.get(row.user_id)?.push(row.permission);
  return result;
}

async function authDetailsForUsers(userIds) {
  const pairs = await Promise.all(userIds.map(async (id) => [id, await getAuthUser(id)]));
  return new Map(pairs);
}

async function getAuthUser(userId) {
  const data = await serviceFetch(`/auth/v1/admin/users/${encodeURIComponent(userId)}`).catch(() => null);
  return data?.user || data || null;
}

async function replacePermissions(userId, requested, actorId, rollbackPermissions) {
  await serviceFetch(`/rest/v1/user_permissions?user_id=eq.${encodeURIComponent(userId)}`, {
    method: 'DELETE', headers: { Prefer: 'return=minimal' },
  });
  if (!requested.length) return;
  try {
    await serviceFetch('/rest/v1/user_permissions', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: requested.map((permission) => ({ user_id: userId, permission, granted_by: actorId })),
    });
  } catch (error) {
    if (rollbackPermissions.length) {
      await serviceFetch('/rest/v1/user_permissions', {
        method: 'POST', headers: { Prefer: 'return=minimal' },
        body: rollbackPermissions.map((permission) => ({ user_id: userId, permission, granted_by: actorId })),
      }).catch(() => null);
    }
    throw error;
  }
}

async function updateFacebookId(userId, rawFacebookId, actorId, currentAccounts = []) {
  const facebookId = nullableText(rawFacebookId, 80);
  if (facebookId && !/^\d+$/.test(facebookId)) throw httpError(400, 'Facebook ID chỉ được chứa chữ số.');
  const accounts = Array.isArray(currentAccounts) ? currentAccounts : [];
  const account = accounts.find((item) => item.is_primary) || accounts[0];
  if (account) {
    await serviceFetch(`/rest/v1/user_facebook_accounts?id=eq.${encodeURIComponent(account.id)}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: {
        facebook_id: facebookId,
        facebook_id_status: facebookId ? 'manual_verified' : 'pending',
        resolved_at: facebookId ? new Date().toISOString() : null,
        resolved_by: facebookId ? actorId : null,
        updated_at: new Date().toISOString(),
      },
    });
    return;
  }
  if (!facebookId) return;
  const profileUrl = `https://www.facebook.com/profile.php?id=${facebookId}`;
  await serviceFetch('/rest/v1/user_facebook_accounts', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: {
      user_id: userId,
      facebook_id: facebookId,
      facebook_url_original: profileUrl,
      facebook_url_normalized: profileUrl,
      facebook_id_status: 'manual_verified',
      resolved_at: new Date().toISOString(),
      resolved_by: actorId,
      is_primary: true,
      metadata: { source: 'unified_user_management' },
    },
  });
}

async function writeAudit(actor, action, userId, before, after, reason) {
  await serviceFetch('/rest/v1/audit_logs', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: {
      actor_id: actor.user.id,
      actor_name: actor.profile.display_name || actor.profile.username || 'System Admin',
      actor_type: 'staff',
      actor_role: actor.profile.is_system_admin ? 'system_admin' : 'user',
      module: 'UserManagement',
      entity: 'user_profiles',
      record_id: userId,
      action,
      before,
      after,
      reason,
    },
  });
}

function serializeUser(user, permissions = [], authUser = null) {
  return {
    ...user,
    permissions: Array.isArray(permissions) ? permissions : [],
    last_sign_in_at: authUser?.last_sign_in_at || null,
  };
}

function auditUser(user) {
  if (!user) return null;
  return {
    user_id: user.user_id, display_name: user.display_name, email: user.email,
    phone: user.phone, status: user.status, metadata: user.metadata,
    web_access_enabled: user.web_access_enabled, is_system_admin: user.is_system_admin,
  };
}

function pagination(body) {
  const page = Math.max(1, Number.parseInt(body.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(body.pageSize, 10) || 25));
  const from = (page - 1) * pageSize;
  return { page, pageSize, from, to: from + pageSize - 1 };
}

function contentRangeTotal(value, fallback) {
  const total = Number(String(value || '').split('/')[1]);
  return Number.isFinite(total) ? total : fallback;
}

function requiredUserId(value) {
  const id = String(value || '');
  if (!USER_ID_PATTERN.test(id)) throw httpError(400, 'User không hợp lệ.');
  return id;
}

function uniqueStrings(value) {
  if (!Array.isArray(value)) throw httpError(400, 'Danh sách quyền không hợp lệ.');
  return [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))];
}

function safeSearch(value) {
  return String(value || '').trim().slice(0, 80).replace(/[%*(),]/g, '');
}

function nullableText(value, max) {
  return String(value ?? '').trim().slice(0, max) || null;
}

function requiredText(value, max, label) {
  const text = nullableText(value, max);
  if (!text) throw httpError(400, `${label} là bắt buộc.`);
  return text;
}

function nonNegativeNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw httpError(400, `${label} không hợp lệ.`);
  return number;
}

function nonZeroNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number === 0) throw httpError(400, `${label} phải khác 0.`);
  return number;
}

function allowedTier(value) {
  const tier = String(value || 'customer');
  if (!['customer', 'silver', 'gold', 'diamond'].includes(tier)) throw httpError(400, 'Cấp bậc TTC không hợp lệ.');
  return tier;
}

function has(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function send(res, payload) {
  return res.status(200).json(payload);
}

module.exports.__test = {
  allowedTier,
  contentRangeTotal,
  safeSearch,
};
