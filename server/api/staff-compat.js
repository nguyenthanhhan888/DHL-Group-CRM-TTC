// LEGACY COMPATIBILITY — REMOVE AFTER STABLE RELEASE.
// New callers use /api/user-management. This adapter intentionally uses the
// unified user profile/direct-permission authorization model.
const { PERMISSIONS } = require('../../shared/permissions.js');
const { requirePermission, serviceFetch } = require('../../api/_auth.js');

module.exports = async function staffCompatibilityHandler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, message: 'Chỉ hỗ trợ phương thức GET.' });
  }
  try {
    await requirePermission(req, PERMISSIONS.USER_MANAGEMENT);
    const params = new URLSearchParams({
      select: 'user_id,username,display_name,email,phone,status,web_access_enabled,is_system_admin,created_at',
      order: 'created_at.desc',
      limit: '100',
    });
    const users = await serviceFetch(`/rest/v1/user_profiles?${params.toString()}`);
    return res.status(200).json({ ok: true, users: users || [], deprecated: true });
  } catch (error) {
    return res.status(error.status || 500).json({ ok: false, message: error.message || 'Không tải được danh sách người dùng.' });
  }
};
