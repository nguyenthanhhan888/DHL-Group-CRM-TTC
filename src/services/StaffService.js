import { getSupabaseClient } from '../supabase/client.js';

export const StaffService = {
  async list() {
    try {
      return await listStaffViaApi();
    } catch (error) {
      try {
        return await invoke({ action: 'list' });
      } catch (edgeError) {
        const fallback = await fallbackListStaff(edgeError);
        return {
          ok: true,
          staff: fallback.staff,
          warning: fallback.warning || edgeError?.message || error?.message || 'Edge Function manage-staff chưa sẵn sàng.',
        };
      }
    }
  },

  async create(payload) {
    return invoke({ action: 'create', reason: 'Admin tạo tài khoản Reviewer', ...payload });
  },

  async resetPassword(userId, password) {
    return invoke({
      action: 'reset_password',
      userId,
      password,
      reason: 'Admin đặt lại mật khẩu Reviewer',
    });
  },

  async update(userId, payload) {
    return invoke({
      action: 'update',
      userId,
      reason: 'Admin cập nhật thông tin Reviewer',
      ...payload,
    });
  },

  async setActive(userId, isActive) {
    return invoke({
      action: 'set_active',
      userId,
      isActive,
      reason: isActive ? 'Admin kích hoạt Reviewer' : 'Admin vô hiệu hóa Reviewer',
    });
  },

};

async function invoke(body) {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase chưa được cấu hình.');
  const { data, error } = await client.functions.invoke('manage-staff', { body });
  if (error) throw new Error(await edgeErrorMessage(error));
  if (!data?.ok) throw new Error(data?.message || 'Không thể quản lý nhân viên.');
  return data;
}

async function listStaffViaApi() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase chưa được cấu hình.');
  const { data: sessionData } = await client.auth.getSession();
  const accessToken = sessionData?.session?.access_token || '';
  if (!accessToken) throw new Error('Bạn cần đăng nhập admin để xem nhân viên.');
  const response = await fetch('/api/staff', {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.message || 'Không tải được nhân viên qua API.');
  }
  return { ok: true, staff: payload.staff || [] };
}

async function fallbackListStaff(originalError) {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase chưa được cấu hình.');
  const { data, error } = await client
    .from('user_roles')
    .select('user_id, username, display_name, role, is_active, created_at')
    .in('role', ['admin', 'reviewer'])
    .order('created_at', { ascending: true });
  if (error) throw error;
  return {
    staff: (data || []).map((item) => ({
      userId: item.user_id,
      username: item.username,
      displayName: item.display_name,
      role: item.role,
      isActive: item.is_active,
      email: '',
      lastSignInAt: null,
      readOnlyFallback: true,
    })),
  };
}

async function edgeErrorMessage(error) {
  try {
    const payload = await error.context?.json();
    return payload?.message || error.message;
  } catch {
    return error.message || 'Edge Function trả về lỗi.';
  }
}
