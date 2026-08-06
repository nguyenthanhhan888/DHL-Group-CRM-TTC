import { getSupabaseClient } from '../supabase/client.js';

export const AuthService = {
  async initialize() {
    const client = requireClient();
    const authHash = /(?:^#|[&#])(access_token|refresh_token|error|error_code)=/.test(window.location.hash);
    const { data, error } = await client.auth.getSession();
    if (error) throw error;

    if (authHash) {
      const nextRoute = data.session ? '#/dashboard' : '#/login';
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${nextRoute}`);
    }

    return data.session || null;
  },

  async signIn(identifier, password) {
    const email = await resolveLoginEmail(identifier);
    const { data, error } = await requireClient().auth.signInWithPassword({ email, password });
    if (error) throw error;
    await ensureAuthenticatedProfile(data, { email });
    return data;
  },

  async signUp({ username = '', email = '', password, displayName = '', phone = '' } = {}) {
    const result = await createUserAccount({ username, email, password, displayName, phone });
    const data = await this.signIn(result.username || username, password);
    return { ...data, account: result };
  },

  async signOut() {
    const { error } = await requireClient().auth.signOut();
    if (error) throw error;
  },

  async getCurrentProfile(userId) {
    if (!userId) return null;
    const client = requireClient();
    const { data, error } = await client.rpc('get_current_app_profile');
    if (!error) {
      return data || {
        profile_type: 'user',
        user_id: userId,
        role: 'user',
        status: 'pending_profile',
        is_active: true,
      };
    }

    const legacyResult = await client.rpc('get_current_staff_profile');
    if (legacyResult.error) throw legacyResult.error;
    return legacyResult.data;
  },

  async getCurrentStaffProfile() {
    const { data, error } = await requireClient().rpc('get_current_staff_profile');
    if (error) throw error;
    return data;
  },
};

function requireClient() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase chưa được cấu hình.');
  return client;
}

async function resolveLoginEmail(identifier) {
  const normalized = String(identifier || '').trim();
  const isEmailIdentifier = /^\S+@\S+\.\S+$/.test(normalized);

  const response = await fetch('/api/auth-account', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'resolve_login', identifier: normalized }),
  });
  const payload = await readApiPayload(response);
  if (isEmailIdentifier && (!response.ok || !payload?.ok || !payload.email)) {
    return normalized.toLowerCase();
  }
  if (!response.ok || !payload?.ok || !payload.email) {
    throw new Error(payload?.message || 'Không tìm thấy tài khoản.');
  }
  return payload.email;
}

async function createUserAccount(payload) {
  const response = await fetch('/api/auth-account', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'create_user_account', ...payload }),
  });
  const data = await readApiPayload(response);
  if (!response.ok || !data?.ok) {
    throw new Error(data?.message || 'Không thể tạo tài khoản.');
  }
  return data;
}

async function readApiPayload(response) {
  const text = await response.text().catch(() => '');
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    if (response.status === 404 || response.status === 405 || response.status === 501) {
      return {
        ok: false,
        message: 'Server local hiện tại chỉ phục vụ file tĩnh, chưa chạy API /api/auth-account. Hãy chạy bằng Vercel dev hoặc deploy lên Vercel.',
      };
    }
    return null;
  }
}

async function ensureAuthenticatedProfile(authData, {
  email = '',
  displayName = '',
  phone = '',
  username = '',
  source = 'auth_session',
} = {}) {
  const session = authData?.session;
  const user = authData?.user || session?.user;
  if (!session?.access_token || !user?.id) return null;

  const client = requireClient();
  const appProfile = await client.rpc('get_current_app_profile');
  if (!appProfile.error && appProfile.data) return appProfile.data;

  const metadata = user.user_metadata || {};
  const { data, error } = await client.rpc('ensure_my_user_profile', {
    display_name_input: normalizeOptional(displayName || metadata.display_name || metadata.name),
    phone_input: normalizeOptional(phone || metadata.phone),
    email_input: normalizeOptional(email || user.email),
    username_input: normalizeOptional(username || metadata.username),
    metadata_input: {
      source,
      auth_user_id: user.id,
    },
  });
  if (error) throw error;
  return data;
}

function normalizeOptional(value) {
  return String(value || '').trim() || null;
}
