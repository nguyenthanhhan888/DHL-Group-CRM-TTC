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
    const username = String(identifier || '').trim().toLowerCase();
    const response = await fetch('/api/auth-account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'username_login', username, password }),
    });
    const payload = await readApiPayload(response);
    if (!response.ok || !payload?.ok || !payload?.session?.accessToken || !payload?.session?.refreshToken) {
      throw new Error('Tên đăng nhập hoặc mật khẩu không chính xác.');
    }
    const { data, error } = await requireClient().auth.setSession({
      access_token: payload.session.accessToken,
      refresh_token: payload.session.refreshToken,
    });
    if (error || !data?.session) throw error || new Error('Tên đăng nhập hoặc mật khẩu không chính xác.');
    const mfaRequirement = await getMfaRequirement();
    if (mfaRequirement.required) {
      return {
        ...data,
        mfaRequired: true,
        mfaFactorId: mfaRequirement.factorId,
      };
    }
    return data;
  },

  async signUp({ username = '', email = '', password, displayName = '', phone = '' } = {}) {
    const result = await createUserAccount({ username, email, password, displayName, phone });
    return { account: result };
  },

  async signOut() {
    const { error } = await requireClient().auth.signOut();
    if (error) throw error;
  },

  async getCurrentProfile(userId) {
    if (!userId) return null;
    const { data, error } = await requireClient().rpc('get_my_access_profile');
    if (error) throw error;
    return normalizeAccessProfile(data, userId);
  },

  async getCurrentStaffProfile() {
    const { data: sessionData, error } = await requireClient().auth.getSession();
    if (error) throw error;
    return this.getCurrentProfile(sessionData?.session?.user?.id);
  },

  async updatePassword(password) {
    const normalized = String(password || '');
    if (normalized.length < 6) throw new Error('Mật khẩu cần ít nhất 6 ký tự.');
    const { data, error } = await requireClient().auth.updateUser({ password: normalized });
    if (error) throw error;
    return data;
  },

  async listMfaFactors() {
    const client = requireClient();
    if (!client.auth?.mfa?.listFactors) throw new Error('Supabase client hiện tại chưa hỗ trợ MFA.');
    const { data, error } = await client.auth.mfa.listFactors();
    if (error) throw error;
    return data || { totp: [], phone: [] };
  },

  async getMfaRequirement() {
    return getMfaRequirement();
  },

  async enrollTotpMfa({ friendlyName = 'DHL Authenticator' } = {}) {
    const client = requireClient();
    if (!client.auth?.mfa?.enroll) throw new Error('Supabase client hiện tại chưa hỗ trợ MFA.');
    const { data, error } = await client.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName,
    });
    if (error) throw error;
    return data;
  },

  async verifyTotpMfa(factorId, code) {
    const client = requireClient();
    const normalizedCode = String(code || '').trim();
    if (!factorId) throw new Error('Thiếu mã thiết bị Authenticator.');
    if (!/^\d{6}$/.test(normalizedCode)) throw new Error('Mã Authenticator gồm 6 chữ số.');
    const challenge = await client.auth.mfa.challenge({ factorId });
    if (challenge.error) throw challenge.error;
    const verify = await client.auth.mfa.verify({
      factorId,
      challengeId: challenge.data?.id,
      code: normalizedCode,
    });
    if (verify.error) throw verify.error;
    return verify.data;
  },

  async completeTotpMfa(factorId, code) {
    await this.verifyTotpMfa(factorId, code);
    const { data, error } = await requireClient().auth.getSession();
    if (error) throw error;
    return data;
  },

  async unenrollMfaFactor(factorId) {
    const client = requireClient();
    if (!factorId) throw new Error('Thiếu thiết bị cần gỡ.');
    const { data, error } = await client.auth.mfa.unenroll({ factorId });
    if (error) throw error;
    return data;
  },
};

function requireClient() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase chưa được cấu hình.');
  return client;
}

async function getMfaRequirement() {
  const client = requireClient();
  if (!client.auth?.mfa?.listFactors) return { required: false, factorId: '' };
  const [{ data: factorsData, error: factorsError }, assuranceResult] = await Promise.all([
    client.auth.mfa.listFactors(),
    client.auth.mfa.getAuthenticatorAssuranceLevel
      ? client.auth.mfa.getAuthenticatorAssuranceLevel()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (factorsError) throw factorsError;
  if (assuranceResult?.error) throw assuranceResult.error;
  const verifiedTotp = (factorsData?.totp || []).find((factor) => factor.status === 'verified');
  if (!verifiedTotp?.id) return { required: false, factorId: '' };
  const aal = assuranceResult?.data;
  if (!aal?.currentLevel || !aal?.nextLevel) {
    return { required: true, factorId: verifiedTotp.id };
  }
  return {
    required: aal.nextLevel === 'aal2' && aal.currentLevel !== 'aal2',
    factorId: verifiedTotp.id,
  };
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

function normalizeAccessProfile(payload, fallbackUserId = '') {
  const source = payload?.profile && typeof payload.profile === 'object' ? payload.profile : payload || {};
  const permissions = payload?.permissions || source.permissions || [];
  return {
    ...source,
    profile_type: 'user',
    user_id: source.user_id || fallbackUserId,
    status: source.status || '',
    web_access_enabled: source.web_access_enabled === true,
    is_system_admin: source.is_system_admin === true,
    permissions: Array.isArray(permissions) ? permissions : [],
  };
}
