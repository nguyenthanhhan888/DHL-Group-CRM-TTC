// LEGACY COMPATIBILITY — REMOVE AFTER STABLE RELEASE.
// Production web code uses /api/user-management. This Edge Function keeps the
// old list caller alive without reintroducing role-based authorization.
import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

const allowedOrigins = new Set([
  'https://nguyenthanhhan888.github.io',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
]);
const baseHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

Deno.serve(async (request: Request) => {
  const origin = request.headers.get('Origin') || '';
  const headers = { ...baseHeaders, ...(allowedOrigins.has(origin) ? { 'Access-Control-Allow-Origin': origin } : {}), Vary: 'Origin' };
  if (origin && !allowedOrigins.has(origin)) return json(403, { ok: false, message: 'Origin không được phép.' }, headers);
  if (request.method === 'OPTIONS') return new Response('ok', { headers });
  if (request.method !== 'POST') return json(405, { ok: false, message: 'Phương thức không được hỗ trợ.' }, headers);
  try {
    const url = Deno.env.get('SUPABASE_URL') || '';
    const secret = Deno.env.get('SUPABASE_SECRET_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') || '';
    if (!url || !secret || !token) return json(401, { ok: false, message: 'Vui lòng đăng nhập.' }, headers);

    const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData.user) return json(401, { ok: false, message: 'Phiên đăng nhập không hợp lệ.' }, headers);

    const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY') || '', {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: access, error: accessError } = await userClient.rpc('get_my_access_profile');
    const profile = access?.profile || access || {};
    const permissions = access?.permissions || profile.permissions || [];
    const allowed = !accessError
      && profile.user_id === authData.user.id
      && profile.status === 'active'
      && profile.web_access_enabled === true
      && (profile.is_system_admin === true || permissions.includes('user-management'));
    if (!allowed) return json(403, { ok: false, message: 'Bạn không có quyền quản lý người dùng.' }, headers);

    const body = await request.json().catch(() => ({}));
    if (body.action !== 'list') {
      return json(410, { ok: false, message: 'Thao tác đã chuyển sang API Quản lý người dùng.' }, headers);
    }
    const { data: users, error } = await admin
      .from('user_profiles')
      .select('user_id,username,display_name,email,phone,status,web_access_enabled,is_system_admin,created_at')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) return json(400, { ok: false, message: 'Không tải được danh sách người dùng.' }, headers);
    return json(200, { ok: true, users: users || [], deprecated: true }, headers);
  } catch {
    return json(500, { ok: false, message: 'Không thể xử lý yêu cầu.' }, { ...baseHeaders });
  }
});

function json(status: number, payload: unknown, headers: Record<string, string>) {
  return new Response(JSON.stringify(payload), { status, headers });
}
