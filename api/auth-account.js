const REQUIRED_ENV = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
const USERNAME_PATTERN = /^[a-z0-9._-]{3,40}$/;
const PHONE_PATTERN = /^\+?[0-9 .()-]{9,20}$/;

module.exports = async function authAccountHandler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, message: 'Chỉ hỗ trợ phương thức POST.' });
  }

  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
  if (missing.length) {
    return res.status(500).json({ ok: false, message: `Thiếu biến môi trường: ${missing.join(', ')}` });
  }

  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    if (body.action === 'resolve_login') return await resolveLogin(body, res);
    if (body.action === 'create_user_account') return await createUserAccount(body, res);
    if (body.action === 'admin_reset_user_password') return await adminResetUserPassword(body, req, res);
    if (body.action === 'admin_update_user_status') return await adminUpdateUserStatus(body, req, res);
    if (body.action === 'admin_update_user_profile') return await adminUpdateUserProfile(body, req, res);
    return res.status(400).json({ ok: false, message: 'Thao tác không hợp lệ.' });
  } catch (error) {
    return res.status(error.status || 500).json({
      ok: false,
      message: error.message || 'Không thể xử lý tài khoản.',
    });
  }
};

async function resolveLogin(body, res) {
  const identifier = clean(body.identifier, 254).toLowerCase();
  if (!identifier) {
    return res.status(400).json({ ok: false, message: 'Vui lòng nhập email, username hoặc SĐT.' });
  }
  if (isEmail(identifier)) {
    const profileMatches = await findUserProfileMatches(identifier);
    if (profileMatches.length === 1) {
      return res.status(200).json({ ok: true, email: profileMatches[0].auth_email || profileMatches[0].email });
    }
    return res.status(200).json({ ok: true, email: identifier });
  }

  const profileMatches = await findUserProfileMatches(identifier);
  if (profileMatches.length > 1) {
    return res.status(409).json({ ok: false, message: 'SĐT này đang gắn với nhiều tài khoản. Vui lòng đăng nhập bằng username.' });
  }
  if (profileMatches.length === 1) {
    return res.status(200).json({ ok: true, email: profileMatches[0].auth_email || profileMatches[0].email });
  }

  const staff = await findStaffByUsername(identifier);
  if (staff?.auth_email) {
    return res.status(200).json({ ok: true, email: staff.auth_email });
  }

  return res.status(404).json({ ok: false, message: 'Không tìm thấy tài khoản.' });
}

async function createUserAccount(body, res) {
  const displayName = clean(body.displayName, 100);
  const username = clean(body.username, 40).toLowerCase();
  const phone = clean(body.phone, 40);
  const email = clean(body.email, 254).toLowerCase();
  const password = String(body.password || '');

  if (!displayName) return res.status(400).json({ ok: false, message: 'Vui lòng nhập họ tên.' });
  if (!USERNAME_PATTERN.test(username)) return res.status(400).json({ ok: false, message: 'Username cần 3-40 ký tự, chỉ gồm chữ thường, số, dấu chấm, gạch ngang hoặc gạch dưới.' });
  if (phone && !PHONE_PATTERN.test(phone)) return res.status(400).json({ ok: false, message: 'Số điện thoại không hợp lệ.' });
  if (email && !isEmail(email)) return res.status(400).json({ ok: false, message: 'Email không hợp lệ.' });
  if (password.length < 6) return res.status(400).json({ ok: false, message: 'Mật khẩu cần ít nhất 6 ký tự.' });

  const [existingUsername, existingPhone] = await Promise.all([
    findUserProfileByUsername(username),
    phone ? findUserProfileMatches(phone) : Promise.resolve([]),
  ]);
  if (existingUsername) return res.status(409).json({ ok: false, message: 'Username đã được sử dụng.' });
  if (existingPhone.length) return res.status(409).json({ ok: false, message: 'Số điện thoại đã có tài khoản.' });

  const authEmail = generatedAuthEmail(username);
  const authData = await createAuthUser({
    email: authEmail,
    password,
    displayName,
    username,
    phone: phone || null,
    contactEmail: email,
  });
  const user = authData?.user || authData;
  const error = authData?.error;
  if (error || !user) return res.status(400).json({ ok: false, message: accountError(error?.message) });

  const profile = {
    user_id: user.id,
    username,
    display_name: displayName,
    phone: phone || null,
    email: email || null,
    status: 'active',
    metadata: {
      source: 'username_signup_api',
      auth_email: authEmail,
      contact_email: email || null,
      username,
    },
  };

  await insertUserProfile(profile).catch(async (profileError) => {
    await deleteAuthUser(user.id).catch(() => null);
    throw profileError;
  });

  await supabaseFetch('/rest/v1/wallets', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ user_id: user.id }),
  }).catch(() => null);

  return res.status(200).json({ ok: true, username, email: authEmail });
}

async function adminResetUserPassword(body, req, res) {
  const actor = await requireAdminActor(req);
  void actor;
  const userId = clean(body.userId, 80);
  const password = String(body.password || '');
  if (!userId) return res.status(400).json({ ok: false, message: 'Thiếu user cần khôi phục mật khẩu.' });
  if (password.length < 6) return res.status(400).json({ ok: false, message: 'Mật khẩu cần ít nhất 6 ký tự.' });

  const profile = await findUserProfileById(userId);
  if (!profile) return res.status(404).json({ ok: false, message: 'Không tìm thấy user khách hàng.' });

  await updateAuthUserPassword(userId, password);
  return res.status(200).json({ ok: true });
}

async function adminUpdateUserStatus(body, req, res) {
  await requireAdminActor(req);
  const userId = clean(body.userId, 80);
  const status = clean(body.status, 40);
  if (!userId) return res.status(400).json({ ok: false, message: 'Thiếu user cần cập nhật.' });
  if (!['active', 'locked', 'pending_profile'].includes(status)) {
    return res.status(400).json({ ok: false, message: 'Trạng thái user không hợp lệ.' });
  }
  const profile = await findUserProfileById(userId);
  if (!profile) return res.status(404).json({ ok: false, message: 'Không tìm thấy user khách hàng.' });
  await updateUserProfileStatus(userId, status);
  return res.status(200).json({ ok: true });
}

async function adminUpdateUserProfile(body, req, res) {
  await requireAdminActor(req);
  const userId = clean(body.userId, 80);
  if (!userId) return res.status(400).json({ ok: false, message: 'Thiếu user cần cập nhật.' });

  const profile = await findUserProfileById(userId);
  if (!profile) return res.status(404).json({ ok: false, message: 'Không tìm thấy user khách hàng.' });

  const hasDisplayName = Object.prototype.hasOwnProperty.call(body, 'displayName');
  const hasEmail = Object.prototype.hasOwnProperty.call(body, 'email');
  const hasPhone = Object.prototype.hasOwnProperty.call(body, 'phone');
  const hasStatus = Object.prototype.hasOwnProperty.call(body, 'status');
  const displayName = hasDisplayName ? clean(body.displayName, 100) : profile.display_name;
  const email = hasEmail ? clean(body.email, 254).toLowerCase() : profile.email;
  const phone = hasPhone ? clean(body.phone, 40) : profile.phone;
  const status = hasStatus ? clean(body.status, 40) : profile.status;
  const metadataPatch = body.metadataPatch && typeof body.metadataPatch === 'object' ? body.metadataPatch : {};

  if (email && !isEmail(email)) return res.status(400).json({ ok: false, message: 'Email không hợp lệ.' });
  if (phone && !PHONE_PATTERN.test(phone)) return res.status(400).json({ ok: false, message: 'Số điện thoại không hợp lệ.' });
  if (status && !['active', 'locked', 'pending_profile'].includes(status)) {
    return res.status(400).json({ ok: false, message: 'Trạng thái user không hợp lệ.' });
  }

  const updatePayload = {
    display_name: displayName || null,
    email: email || null,
    phone: phone || null,
    status: status || profile.status || 'pending_profile',
    metadata: {
      ...(profile.metadata && typeof profile.metadata === 'object' ? profile.metadata : {}),
      ...metadataPatch,
    },
    updated_at: new Date().toISOString(),
  };

  await updateUserProfile(userId, updatePayload);
  return res.status(200).json({ ok: true });
}

async function insertUserProfile(profile) {
  return supabaseFetch('/rest/v1/user_profiles', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(profile),
  }).catch((error) => {
    if (!isMissingUsernameColumn(error)) throw error;
    const { username, ...profileWithoutUsername } = profile;
    void username;
    return supabaseFetch('/rest/v1/user_profiles', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(profileWithoutUsername),
    });
  });
}

async function findUserProfileByUsername(username) {
  const params = new URLSearchParams({
    select: 'user_id,username,email,metadata',
    username: `eq.${username}`,
    limit: '1',
  });
  const rows = await supabaseFetch(`/rest/v1/user_profiles?${params.toString()}`).catch((error) => {
    if (isMissingUsernameColumn(error)) return findUserProfileByMetadataUsername(username);
    throw error;
  });
  return rows?.[0] || null;
}

async function findUserProfileById(userId) {
  const params = new URLSearchParams({
    select: 'user_id,username,display_name,email,phone,status,metadata',
    user_id: `eq.${userId}`,
    limit: '1',
  });
  const rows = await supabaseFetch(`/rest/v1/user_profiles?${params.toString()}`).catch((error) => {
    if (isMissingUsernameColumn(error)) return findUserProfileByIdWithoutUsernameColumn(userId);
    throw error;
  });
  return rows?.[0] || null;
}

async function findUserProfileByIdWithoutUsernameColumn(userId) {
  const params = new URLSearchParams({
    select: 'user_id,display_name,email,phone,status,metadata',
    user_id: `eq.${userId}`,
    limit: '1',
  });
  const rows = await supabaseFetch(`/rest/v1/user_profiles?${params.toString()}`);
  return hydrateProfileUsernames(rows);
}

async function findUserProfileMatches(identifier) {
  const normalized = clean(identifier, 254).toLowerCase();
  const filters = [`username.eq.${escapePostgrestValue(normalized)}`];
  if (PHONE_PATTERN.test(identifier)) filters.push(`phone.eq.${escapePostgrestValue(clean(identifier, 40))}`);
  if (isEmail(normalized)) filters.push(`email.eq.${escapePostgrestValue(normalized)}`);

  const params = new URLSearchParams({
    select: 'user_id,username,email,phone,metadata',
    or: `(${filters.join(',')})`,
    limit: '2',
  });
  const rows = await supabaseFetch(`/rest/v1/user_profiles?${params.toString()}`).catch((error) => {
    if (isMissingUsernameColumn(error)) return findUserProfileMatchesWithoutUsernameColumn(identifier);
    throw error;
  });
  return normalizeProfileMatches(rows);
}

async function findUserProfileMatchesWithoutUsernameColumn(identifier) {
  const normalized = clean(identifier, 254).toLowerCase();
  if (PHONE_PATTERN.test(identifier)) {
    const params = new URLSearchParams({
      select: 'user_id,email,phone,metadata',
      phone: `eq.${clean(identifier, 40)}`,
      limit: '2',
    });
    const rows = await supabaseFetch(`/rest/v1/user_profiles?${params.toString()}`);
    return normalizeProfileMatches(rows);
  }
  if (isEmail(normalized)) {
    const params = new URLSearchParams({
      select: 'user_id,email,phone,metadata',
      email: `eq.${normalized}`,
      limit: '2',
    });
    const rows = await supabaseFetch(`/rest/v1/user_profiles?${params.toString()}`);
    return normalizeProfileMatches(rows);
  }
  const rows = await findUserProfileByMetadataUsername(normalized);
  return normalizeProfileMatches(rows);
}

async function findUserProfileByMetadataUsername(username) {
  const params = new URLSearchParams({
    select: 'user_id,email,phone,metadata',
    'metadata->>username': `eq.${username}`,
    limit: '2',
  });
  return supabaseFetch(`/rest/v1/user_profiles?${params.toString()}`);
}

function normalizeProfileMatches(rows) {
  return hydrateProfileUsernames(rows).filter((row) => row.auth_email);
}

function hydrateProfileUsernames(rows) {
  return (rows || []).map((row) => ({
    ...row,
    username: row.username || row.metadata?.username || '',
    auth_email: row.metadata?.auth_email || row.email,
  }));
}

async function findStaffByUsername(username) {
  const params = new URLSearchParams({
    select: 'user_id,username',
    username: `eq.${username}`,
    is_active: 'eq.true',
    limit: '1',
  });
  const rows = await supabaseFetch(`/rest/v1/user_roles?${params.toString()}`);
  const staff = rows?.[0];
  if (!staff?.user_id) return null;
  const user = await getAuthUserById(staff.user_id);
  return { ...staff, auth_email: user?.email || '' };
}

async function createAuthUser({ email, password, displayName, username, phone, contactEmail }) {
  return supabaseFetch('/auth/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: displayName, username, phone, contact_email: contactEmail || null },
      app_metadata: { account_type: 'user' },
    }),
  });
}

async function getAuthUserById(userId) {
  const data = await supabaseFetch(`/auth/v1/admin/users/${encodeURIComponent(userId)}`);
  return data?.user || data || null;
}

async function updateAuthUserPassword(userId, password) {
  return supabaseFetch(`/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: 'PUT',
    body: JSON.stringify({ password }),
  });
}

async function updateUserProfileStatus(userId, status) {
  return supabaseFetch(`/rest/v1/user_profiles?user_id=eq.${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ status }),
  });
}

async function updateUserProfile(userId, payload) {
  return supabaseFetch(`/rest/v1/user_profiles?user_id=eq.${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(payload),
  });
}

async function deleteAuthUser(userId) {
  return supabaseFetch(`/auth/v1/admin/users/${encodeURIComponent(userId)}`, { method: 'DELETE' });
}

async function requireAdminActor(req) {
  const accessToken = parseBearer(req.headers.authorization || '');
  if (!accessToken) {
    const error = new Error('Bạn cần đăng nhập admin.');
    error.status = 401;
    throw error;
  }
  const actor = await getCurrentAuthUser(accessToken);
  const role = await findUserRole(actor.id);
  if (role?.role !== 'admin' || role.is_active === false) {
    const error = new Error('Chỉ admin mới được thao tác.');
    error.status = 403;
    throw error;
  }
  return { ...actor, role: role.role };
}

async function getCurrentAuthUser(accessToken) {
  const data = await supabaseFetch('/auth/v1/user', { serviceRole: false, accessToken });
  const user = data?.user || data;
  if (!user?.id) {
    const error = new Error('Phiên đăng nhập không hợp lệ.');
    error.status = 401;
    throw error;
  }
  return user;
}

async function findUserRole(userId) {
  const params = new URLSearchParams({
    select: 'role,is_active',
    user_id: `eq.${userId}`,
    limit: '1',
  });
  const rows = await supabaseFetch(`/rest/v1/user_roles?${params.toString()}`);
  return rows?.[0] || null;
}

function parseBearer(value) {
  const match = String(value || '').match(/^Bearer\s+(.+)$/i);
  return match?.[1] || '';
}

async function supabaseFetch(path, { serviceRole = true, accessToken = '', ...options } = {}) {
  const key = serviceRole ? process.env.SUPABASE_SERVICE_ROLE_KEY : process.env.SUPABASE_ANON_KEY;
  const response = await fetch(`${process.env.SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${accessToken || key}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!response.ok) {
    const error = new Error(data?.message || data?.msg || response.statusText);
    error.status = response.status;
    throw error;
  }
  return data;
}

function clean(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function isEmail(value) {
  return /^\S+@\S+\.\S+$/.test(String(value || '').trim());
}

function generatedAuthEmail(username) {
  return `${username}@users.dhl.local`;
}

function escapePostgrestValue(value) {
  return String(value).replace(/["\\]/g, '\\$&');
}

function accountError(message = '') {
  if (/already|registered|exists/i.test(message)) return 'Username đã được sử dụng.';
  if (/password/i.test(message)) return 'Mật khẩu chưa hợp lệ.';
  return message || 'Không tạo được tài khoản.';
}

function isMissingUsernameColumn(error) {
  return /user_profiles\.username|username.*does not exist|column .*username|username.*column|column.*username/i.test(String(error?.message || ''));
}
