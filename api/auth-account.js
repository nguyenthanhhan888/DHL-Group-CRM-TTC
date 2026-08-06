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
  if (!PHONE_PATTERN.test(phone)) return res.status(400).json({ ok: false, message: 'Số điện thoại không hợp lệ.' });
  if (email && !isEmail(email)) return res.status(400).json({ ok: false, message: 'Email không hợp lệ.' });
  if (password.length < 6) return res.status(400).json({ ok: false, message: 'Mật khẩu cần ít nhất 6 ký tự.' });

  const [existingUsername, existingPhone] = await Promise.all([
    findUserProfileByUsername(username),
    findUserProfileMatches(phone),
  ]);
  if (existingUsername) return res.status(409).json({ ok: false, message: 'Username đã được sử dụng.' });
  if (existingPhone.length) return res.status(409).json({ ok: false, message: 'Số điện thoại đã có tài khoản.' });

  const authEmail = generatedAuthEmail(username);
  const authData = await createAuthUser({
    email: authEmail,
    password,
    displayName,
    username,
    phone,
    contactEmail: email,
  });
  const user = authData?.user || authData;
  const error = authData?.error;
  if (error || !user) return res.status(400).json({ ok: false, message: accountError(error?.message) });

  const profile = {
    user_id: user.id,
    username,
    display_name: displayName,
    phone,
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
    return supabaseFetch(`/rest/v1/user_profiles?${params.toString()}`);
  }
  if (isEmail(normalized)) {
    const params = new URLSearchParams({
      select: 'user_id,email,phone,metadata',
      email: `eq.${normalized}`,
      limit: '2',
    });
    return supabaseFetch(`/rest/v1/user_profiles?${params.toString()}`);
  }
  return findUserProfileByMetadataUsername(normalized);
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
  return (rows || []).map((row) => ({
    ...row,
    username: row.username || row.metadata?.username || '',
    auth_email: row.metadata?.auth_email || row.email,
  })).filter((row) => row.auth_email);
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

async function deleteAuthUser(userId) {
  return supabaseFetch(`/auth/v1/admin/users/${encodeURIComponent(userId)}`, { method: 'DELETE' });
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
