const REQUIRED_ENV = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];

module.exports = async function staffHandler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, message: 'Chỉ hỗ trợ phương thức GET.' });
  }

  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
  if (missing.length) {
    return res.status(500).json({ ok: false, message: `Thiếu biến môi trường: ${missing.join(', ')}` });
  }

  const accessToken = parseBearer(req.headers.authorization || '');
  if (!accessToken) {
    return res.status(401).json({ ok: false, message: 'Bạn cần đăng nhập admin để xem nhân viên.' });
  }

  try {
    const actor = await getAuthUser(accessToken);
    const actorRole = await getStaffRole(actor.id);
    if (!actorRole || actorRole.role !== 'admin' || actorRole.is_active === false) {
      return res.status(403).json({ ok: false, message: 'Chỉ admin đang hoạt động được xem danh sách nhân viên.' });
    }

    const [roles, authUsers] = await Promise.all([listStaffRoles(), listAuthUsers()]);
    const authById = new Map(authUsers.map((user) => [user.id, user]));
    return res.status(200).json({
      ok: true,
      staff: roles.map((role) => {
        const auth = authById.get(role.user_id) || {};
        return {
          userId: role.user_id,
          username: role.username,
          displayName: role.display_name,
          role: role.role,
          isActive: role.is_active,
          email: auth.email || '',
          lastSignInAt: auth.last_sign_in_at || null,
        };
      }),
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      ok: false,
      message: error.message || 'Không tải được danh sách nhân viên.',
    });
  }
};

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

async function getAuthUser(accessToken) {
  return supabaseFetch('/auth/v1/user', { serviceRole: false, accessToken });
}

async function getStaffRole(userId) {
  const params = new URLSearchParams({
    select: 'user_id,role,is_active',
    user_id: `eq.${userId}`,
    limit: '1',
  });
  const rows = await supabaseFetch(`/rest/v1/user_roles?${params.toString()}`);
  return rows?.[0] || null;
}

async function listStaffRoles() {
  const params = new URLSearchParams({
    select: 'user_id,username,display_name,role,is_active,created_at',
    role: 'in.(admin,reviewer)',
    order: 'created_at.asc',
  });
  return supabaseFetch(`/rest/v1/user_roles?${params.toString()}`);
}

async function listAuthUsers(page = 1, acc = []) {
  const data = await supabaseFetch(`/auth/v1/admin/users?page=${page}&per_page=100`);
  const users = acc.concat(data?.users || []);
  if ((data?.users || []).length < 100) return users;
  return listAuthUsers(page + 1, users);
}
