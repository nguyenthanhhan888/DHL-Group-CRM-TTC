const {
  authFetch,
  httpError,
  normalizeAccessProfile,
  serviceFetch,
  userRpc,
} = require('./_auth.js');

const USERNAME_PATTERN = /^[a-z0-9._-]{3,40}$/;
const PHONE_PATTERN = /^\+?[0-9 .()-]{9,20}$/;
const GENERIC_LOGIN_ERROR = 'Tên đăng nhập hoặc mật khẩu không chính xác.';
const LOGIN_WINDOW_MS = 5 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 5;
const loginAttempts = new Map();

module.exports = async function authAccountHandler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, message: 'Chỉ hỗ trợ phương thức POST.' });
  }

  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    if (body.action === 'username_login') return await usernameLogin(body, req, res);
    if (body.action === 'create_user_account') return await createUserAccount(body, res);
    if (body.action === 'resolve_login') {
      return res.status(410).json({ ok: false, message: GENERIC_LOGIN_ERROR });
    }
    if (String(body.action || '').startsWith('admin_')) {
      return res.status(410).json({
        ok: false,
        message: 'Thao tác quản lý tài khoản đã chuyển sang API Quản lý người dùng.',
      });
    }
    return res.status(400).json({ ok: false, message: 'Thao tác không hợp lệ.' });
  } catch (error) {
    return res.status(error.status || 500).json({
      ok: false,
      message: error.message || 'Không thể xử lý tài khoản.',
    });
  }
};

async function usernameLogin(body, req, res) {
  const username = clean(body.username, 40).toLowerCase();
  const password = String(body.password || '');
  const rateKey = `${requestIp(req)}:${username || '-'}`;
  if (!USERNAME_PATTERN.test(username) || !password || isRateLimited(rateKey)) {
    recordFailedAttempt(rateKey);
    return genericLoginFailure(res, isRateLimited(rateKey) ? 429 : 401);
  }

  try {
    const profile = await findProfileForLogin(username);
    if (!profile?.user_id) throw httpError(401, GENERIC_LOGIN_ERROR);
    const authUser = await serviceFetch(`/auth/v1/admin/users/${encodeURIComponent(profile.user_id)}`);
    const internalEmail = authUser?.user?.email || authUser?.email || '';
    if (!internalEmail) throw httpError(401, GENERIC_LOGIN_ERROR);

    const authSession = await authFetch('/auth/v1/token?grant_type=password', {
      method: 'POST',
      useAnonKey: true,
      body: { email: internalEmail, password },
    });
    if (!authSession?.access_token || !authSession?.refresh_token || authSession?.user?.id !== profile.user_id) {
      throw httpError(401, GENERIC_LOGIN_ERROR);
    }

    const access = normalizeAccessProfile(await userRpc('get_my_access_profile', {}, authSession.access_token));
    const allowed = access.user_id === profile.user_id
      && access.status === 'active'
      && access.web_access_enabled === true
      && (access.is_system_admin || access.permissions.length > 0);
    if (!allowed) {
      await authFetch('/auth/v1/logout?scope=local', {
        method: 'POST',
        useAnonKey: true,
        accessToken: authSession.access_token,
      }).catch(() => null);
      throw httpError(401, GENERIC_LOGIN_ERROR);
    }

    loginAttempts.delete(rateKey);
    return res.status(200).json({
      ok: true,
      session: {
        accessToken: authSession.access_token,
        refreshToken: authSession.refresh_token,
        expiresIn: authSession.expires_in || null,
        expiresAt: authSession.expires_at || null,
        tokenType: authSession.token_type || 'bearer',
      },
    });
  } catch {
    recordFailedAttempt(rateKey);
    return genericLoginFailure(res, isRateLimited(rateKey) ? 429 : 401);
  }
}

async function createUserAccount(body, res) {
  const displayName = clean(body.displayName, 100);
  const username = clean(body.username, 40).toLowerCase();
  const phone = clean(body.phone, 40);
  const email = clean(body.email, 254).toLowerCase();
  const password = String(body.password || '');

  if (!displayName) return res.status(400).json({ ok: false, message: 'Vui lòng nhập họ tên.' });
  if (!USERNAME_PATTERN.test(username)) return res.status(400).json({ ok: false, message: 'Username không hợp lệ.' });
  if (phone && !PHONE_PATTERN.test(phone)) return res.status(400).json({ ok: false, message: 'Số điện thoại không hợp lệ.' });
  if (email && !isEmail(email)) return res.status(400).json({ ok: false, message: 'Email không hợp lệ.' });
  if (password.length < 8) return res.status(400).json({ ok: false, message: 'Mật khẩu cần ít nhất 8 ký tự.' });

  const existing = await findProfileForLogin(username);
  if (existing) return res.status(409).json({ ok: false, message: 'Username đã được sử dụng.' });

  const internalEmail = `${username}@users.dhl.local`;
  const authData = await serviceFetch('/auth/v1/admin/users', {
    method: 'POST',
    body: {
      email: internalEmail,
      password,
      email_confirm: true,
      user_metadata: { display_name: displayName },
      app_metadata: { account_type: 'user' },
    },
  });
  const user = authData?.user || authData;
  if (!user?.id) throw httpError(400, 'Không tạo được tài khoản.');

  try {
    await serviceFetch('/rest/v1/user_profiles', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: {
        user_id: user.id,
        username,
        display_name: displayName,
        phone: phone || null,
        email: email || null,
        status: 'active',
        web_access_enabled: false,
        is_system_admin: false,
        metadata: { source: 'username_signup_api' },
      },
    });
    await serviceFetch('/rest/v1/wallets', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: { user_id: user.id },
    }).catch(() => null);
  } catch (error) {
    await serviceFetch(`/auth/v1/admin/users/${encodeURIComponent(user.id)}`, { method: 'DELETE' }).catch(() => null);
    throw error;
  }

  return res.status(200).json({ ok: true, username });
}

async function findProfileForLogin(username) {
  const params = new URLSearchParams({
    select: 'user_id,username,status,web_access_enabled,is_system_admin',
    username: `eq.${username}`,
    limit: '1',
  });
  const rows = await serviceFetch(`/rest/v1/user_profiles?${params.toString()}`);
  return Array.isArray(rows) ? rows[0] || null : null;
}

function genericLoginFailure(res, status = 401) {
  return res.status(status).json({ ok: false, message: GENERIC_LOGIN_ERROR });
}

function isRateLimited(key) {
  const current = loginAttempts.get(key);
  if (!current) return false;
  if (Date.now() - current.startedAt >= LOGIN_WINDOW_MS) {
    loginAttempts.delete(key);
    return false;
  }
  return current.count >= LOGIN_MAX_ATTEMPTS;
}

function recordFailedAttempt(key) {
  const now = Date.now();
  const current = loginAttempts.get(key);
  if (!current || now - current.startedAt >= LOGIN_WINDOW_MS) {
    loginAttempts.set(key, { count: 1, startedAt: now });
    return;
  }
  current.count += 1;
}

function requestIp(req) {
  const forwarded = String(req?.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req?.socket?.remoteAddress || 'unknown';
}

function clean(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function isEmail(value) {
  return /^\S+@\S+\.\S+$/.test(String(value || '').trim());
}

module.exports.__test = {
  GENERIC_LOGIN_ERROR,
  loginAttempts,
};
