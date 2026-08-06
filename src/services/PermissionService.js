import { requireSupabaseClient, runQuery } from './BaseService.js';

export const PermissionService = {
  async getMyPermissions() {
    const { data } = await runQuery(requireSupabaseClient().rpc('get_my_permissions'));
    return Array.isArray(data) ? data : [];
  },

  async getRolePermissions(role) {
    const { data } = await runQuery(requireSupabaseClient().rpc('get_role_permissions_admin', {
      role_input: String(role || '').trim(),
    }));
    return Array.isArray(data) ? data : [];
  },

  async updateReviewerPermissions(permissions, reason = 'Cập nhật quyền Reviewer') {
    const { data } = await runQuery(requireSupabaseClient().rpc('update_reviewer_permissions', {
      permissions_input: Array.isArray(permissions) ? permissions : [],
      reason_input: reason,
    }));
    return Array.isArray(data) ? data : [];
  },
};
