import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

const allowedOrigins = new Set([
  'https://nguyenthanhhan888.github.io',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
]);
const requestOrigin = (request: Request) => {
  const origin = request.headers.get('Origin') || '';
  return allowedOrigins.has(origin) ? origin : '';
};
const headers = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

function corsHeaders(request: Request) {
  const origin = requestOrigin(request);
  return { ...headers, ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}), Vary: 'Origin' };
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get('Origin');
  if (origin && !allowedOrigins.has(origin)) {
    return respond(403, 'Origin không được phép.', request);
  }
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(request) });
  if (request.method !== 'POST') return respond(405, 'Phương thức không được hỗ trợ.', request);

  try {
    const url = Deno.env.get('SUPABASE_URL');
    const secretKey = serviceKey();
    if (!url || !secretKey) return respond(500, 'Máy chủ chưa được cấu hình đầy đủ.', request);

    const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
    if (!token) return respond(401, 'Vui lòng đăng nhập.', request);

    const admin = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData.user) return respond(401, 'Phiên đăng nhập không hợp lệ.', request);

    const { data: profile } = await admin.from('user_roles').select('role, is_active, display_name, username').eq('user_id', authData.user.id).single();
    if (!profile || !profile.is_active || profile.role !== 'admin') {
      return respond(403, 'Bạn không có quyền quản lý nhân viên.', request);
    }

    const actor = {
      actor_id: authData.user.id,
      actor_name: profile.display_name || profile.username || 'Admin',
      actor_type: 'staff',
      actor_role: profile.role,
    };

    const body = await request.json();
    if (body.action === 'list') return await listStaff(admin, request);
    if (body.action === 'create') return await createStaff(admin, body, actor, request);
    if (body.action === 'reset_password') return await resetPassword(admin, body, actor, request);
    if (body.action === 'update') return await updateStaff(admin, body, actor, request);
    if (body.action === 'set_active') return await setStaffActive(admin, body, actor, request);
    if (body.action === 'delete') return respond(400, 'Không xóa cứng nhân viên. Hãy vô hiệu hóa tài khoản.', request);
    return respond(400, 'Thao tác không hợp lệ.', request);
  } catch (error) {
    console.error('manage-staff error', error);
    return respond(500, 'Không thể xử lý yêu cầu quản lý nhân viên.', request);
  }
});

async function logAction(admin, actor, logData) {
  const target = logData.after || logData.before || {};
  const { error } = await admin.from('audit_logs').insert({
    ...actor,
    entity: 'user_roles',
    record_id: target.user_id || null,
    ...logData,
  });
  if (error) {
    throw new Error(`Audit log failed: ${error.message}`);
  }
}

async function listStaff(admin: ReturnType<typeof createClient>, request: Request) {
  const [{ data: roles, error: rolesError }, { data: usersData, error: usersError }, { data: reviews, error: reviewsError }] = await Promise.all([
    admin.from('user_roles').select('user_id, username, display_name, role, is_active, created_at').order('created_at'),
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    admin.from('registration_requests').select('reviewed_by').not('reviewed_by', 'is', null),
  ]);
  if (rolesError || usersError || reviewsError) return respond(400, 'Không tải được danh sách nhân viên.', request);
  const users = new Map(usersData.users.map((user) => [user.id, user]));
  const reviewCounts = new Map<string, number>();
  for (const review of reviews || []) reviewCounts.set(review.reviewed_by, (reviewCounts.get(review.reviewed_by) || 0) + 1);
  const staff = (roles || []).map((profile) => {
    const user = users.get(profile.user_id);
    return {
      userId: profile.user_id,
      username: profile.username,
      displayName: profile.display_name,
      role: profile.role,
      isActive: profile.is_active,
      email: user?.email || '',
      lastSignInAt: user?.last_sign_in_at || null,
      reviewedCount: reviewCounts.get(profile.user_id) || 0,
    };
  });
  return json(200, { ok: true, staff }, request);
}

async function createStaff(admin: ReturnType<typeof createClient>, body: Record<string, unknown>, actor: Record<string, string>, request: Request) {
  const displayName = clean(body.displayName, 100);
  const username = clean(body.username, 40).toLowerCase();
  const email = clean(body.email, 254).toLowerCase();
  const password = String(body.password || '');
  if (!displayName || !/^[a-z0-9._-]{3,40}$/.test(username)) return respond(400, 'Họ tên hoặc username không hợp lệ.', request);
  if (!/^\S+@\S+\.\S+$/.test(email)) return respond(400, 'Email không hợp lệ.', request);
  if (password.length < 6) return respond(400, 'Mật khẩu phải có ít nhất 6 ký tự.', request);

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: displayName },
    app_metadata: { managed_role: 'reviewer' },
  });
  if (error || !data.user) return respond(400, accountError(error?.message), request);

  const newUserRole = {
    user_id: data.user.id,
    username,
    display_name: displayName,
    role: 'reviewer',
    is_active: true,
  };

  const { error: profileError } = await admin.from('user_roles').insert(newUserRole);
  if (profileError) {
    await admin.auth.admin.deleteUser(data.user.id);
    return respond(400, profileError.code === '23505' ? 'Username đã được sử dụng.' : 'Không tạo được hồ sơ nhân viên.', request);
  }

  await logAction(admin, actor, {
    module: 'Staff',
    action: 'create',
    before: null,
    after: newUserRole,
    reason: body.reason,
  });

  return json(200, { ok: true, userId: data.user.id }, request);
}

async function resetPassword(admin: ReturnType<typeof createClient>, body: Record<string, unknown>, actor: Record<string, string>, request: Request) {
  const userId = String(body.userId || '');
  const password = String(body.password || '');
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return respond(400, 'Tài khoản không hợp lệ.', request);
  if (password.length < 6) return respond(400, 'Mật khẩu phải có ít nhất 6 ký tự.', request);

  const { data: target, error: targetError } = await admin.from('user_roles').select('*').eq('user_id', userId).single();
  if (targetError || !target) return respond(400, 'Không tìm thấy tài khoản nhân viên.', request);
  if (target?.role !== 'reviewer') return respond(400, 'Chỉ có thể đặt lại mật khẩu nhân viên kiểm duyệt.', request);

  const { error } = await admin.auth.admin.updateUserById(userId, { password });
  if (error) return respond(400, 'Không cập nhật được mật khẩu.', request);

  await logAction(admin, actor, {
    module: 'Staff',
    action: 'reset_password',
    before: target,
    after: target,
    reason: body.reason,
  });

  return json(200, { ok: true }, request);
}

async function updateStaff(admin: ReturnType<typeof createClient>, body: Record<string, unknown>, actor: Record<string, string>, request: Request) {
  const userId = String(body.userId || '');
  const displayName = clean(body.displayName, 100);
  const username = clean(body.username, 40).toLowerCase();
  const email = clean(body.email, 254).toLowerCase();
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return respond(400, 'Tài khoản không hợp lệ.', request);
  if (!displayName || !/^[a-z0-9._-]{3,40}$/.test(username)) return respond(400, 'Họ tên hoặc username không hợp lệ.', request);
  if (!/^\S+@\S+\.\S+$/.test(email)) return respond(400, 'Email không hợp lệ.', request);

  const { data: current, error: currentError } = await admin.from('user_roles').select('*').eq('user_id', userId).single();
  if (currentError || !current) return respond(400, 'Không tìm thấy tài khoản nhân viên.', request);
  if (current?.role !== 'reviewer') return respond(400, 'Chỉ có thể sửa tài khoản nhân viên kiểm duyệt.', request);

  const { data: duplicate } = await admin.from('user_roles').select('user_id').eq('username', username).neq('user_id', userId).maybeSingle();
  if (duplicate) return respond(400, 'Username đã được sử dụng.', request);

  const updatedProfile = {
    username,
    display_name: displayName,
    updated_at: new Date().toISOString(),
  };

  const { error: profileError } = await admin.from('user_roles').update(updatedProfile).eq('user_id', userId);
  if (profileError) return respond(400, 'Không cập nhật được hồ sơ nhân viên.', request);

  const { error: authError } = await admin.auth.admin.updateUserById(userId, {
    email,
    email_confirm: true,
    user_metadata: { display_name: displayName },
  });
  if (authError) {
    await admin.from('user_roles').update({ username: current.username, display_name: current.display_name }).eq('user_id', userId);
    return respond(400, /already|registered|exists/i.test(authError.message) ? 'Email đã có tài khoản.' : 'Không cập nhật được tài khoản Auth.', request);
  }

  await logAction(admin, actor, {
    module: 'Staff',
    action: 'update',
    before: current,
    after: { ...current, ...updatedProfile },
    reason: body.reason,
  });

  return json(200, { ok: true }, request);
}

async function setStaffActive(admin: ReturnType<typeof createClient>, body: Record<string, unknown>, actor: Record<string, string>, request: Request) {
  const userId = String(body.userId || '');
  const isActive = body.isActive === true;
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return respond(400, 'Tài khoản không hợp lệ.', request);

  const { data: target, error: targetError } = await admin.from('user_roles').select('*').eq('user_id', userId).single();
  if (targetError || !target) return respond(400, 'Không tìm thấy tài khoản nhân viên.', request);
  if (target?.role !== 'reviewer') return respond(400, 'Chỉ có thể khóa hoặc mở tài khoản nhân viên kiểm duyệt.', request);

  const { error: authError } = await admin.auth.admin.updateUserById(userId, {
    ban_duration: isActive ? 'none' : '876000h',
  });
  if (authError) return respond(400, 'Không cập nhật được trạng thái đăng nhập.', request);

  const { error } = await admin.from('user_roles').update({ is_active: isActive, updated_at: new Date().toISOString() }).eq('user_id', userId);
  if (error) {
    await admin.auth.admin.updateUserById(userId, {
      ban_duration: isActive ? '876000h' : 'none',
    });
    return respond(400, 'Không cập nhật được trạng thái tài khoản.', request);
  }

  await logAction(admin, actor, {
    module: 'Staff',
    action: 'set_active',
    before: target,
    after: { ...target, is_active: isActive },
    reason: body.reason,
  });

  return json(200, { ok: true }, request);
}

function serviceKey() {
  const direct = Deno.env.get('SUPABASE_SECRET_KEY');
  if (direct) return direct;
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}');
    const value = keys.default;
    const configured = typeof value === 'string' ? value : value?.key || '';
    if (configured) return configured;
  } catch {
    // Fall through to Supabase's built-in server-side key.
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
}

function clean(value: unknown, max: number) {
  return String(value || '').trim().slice(0, max);
}

function accountError(message = '') {
  if (/already|registered|exists/i.test(message)) return 'Email đã có tài khoản.';
  return 'Không tạo được tài khoản Auth.';
}

function respond(status: number, message: string, request?: Request) {
  return json(status, { ok: false, message }, request);
}

function json(status: number, payload: unknown, request?: Request) {
  return new Response(JSON.stringify(payload), { status, headers: request ? corsHeaders(request) : headers });
}
