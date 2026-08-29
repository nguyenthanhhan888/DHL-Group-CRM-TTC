import { getSupabaseClient } from '../supabase/client.js';

export const StaffService = {
  async list({ search = '', page = 1, pageSize = 25 } = {}) {
    return invoke({ action: 'list', search, page, pageSize });
  },

  async detail(userId) {
    return invoke({ action: 'detail', userId });
  },

  async updateProfile(userId, payload) {
    return invoke({ action: 'update_profile', userId, ...payload });
  },

  async syncPermissions(userId, permissions, adminPassword, reason = '') {
    return invoke({ action: 'sync_permissions', userId, permissions, adminPassword, reason });
  },

  async adjustWallet(userId, { amount, reason, description = '', adminPassword, idempotencyKey } = {}) {
    return invoke({ action: 'adjust_wallet', userId, amount, reason, description, adminPassword, idempotencyKey });
  },

  async walletLedger(userId, { page = 1, pageSize = 20 } = {}) {
    return invoke({ action: 'wallet_ledger', userId, page, pageSize });
  },

  async setLocked(userId, locked, adminPassword, reason) {
    return invoke({ action: 'set_locked', userId, locked, adminPassword, reason });
  },

  async resetPassword(userId, newPassword, adminPassword, reason) {
    return invoke({ action: 'reset_password', userId, newPassword, adminPassword, reason });
  },
};

async function invoke(body) {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase chưa được cấu hình.');
  const { data: sessionData } = await client.auth.getSession();
  const accessToken = sessionData?.session?.access_token || '';
  if (!accessToken) throw new Error('Bạn cần đăng nhập để quản lý người dùng.');
  const response = await fetch('/api/user-management', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    const error = new Error(payload?.message || 'Không thể quản lý người dùng.');
    error.status = response.status;
    throw error;
  }
  return payload;
}
