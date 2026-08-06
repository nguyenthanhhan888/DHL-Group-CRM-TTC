alter table public.user_roles enable row level security;
alter table public.role_permissions enable row level security;

revoke all on table public.user_roles from public, anon, authenticated;
revoke all on table public.role_permissions from public, anon, authenticated;

insert into public.role_permissions(role, permissions)
values('support', array['dashboard'])
on conflict (role) do nothing;

update public.role_permissions
set permissions = array_remove(permissions, 'settings')
where lower(role) <> 'admin'
  and 'settings' = any(permissions);

create or replace function private.assert_active_admin()
returns public.user_roles
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  actor public.user_roles%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Bạn phải đăng nhập.' using errcode = '42501';
  end if;

  select *
  into actor
  from public.user_roles ur
  where ur.user_id = auth.uid()
    and ur.is_active = true
    and lower(ur.role) = 'admin';

  if not found then
    raise exception 'Chỉ Admin đang hoạt động được thực hiện thao tác này.'
      using errcode = '42501';
  end if;
  return actor;
end;
$function$;

create or replace function public.has_active_permission(permission_input text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.user_roles ur
    where ur.user_id = auth.uid()
      and ur.is_active = true
      and (
        lower(ur.role) = 'admin'
        or exists (
          select 1
          from public.role_permissions rp
          where lower(rp.role) = lower(ur.role)
            and permission_input = any(rp.permissions)
        )
      )
  );
$function$;

do $block$
declare
  access_rule record;
begin
  for access_rule in
    select *
    from (values
      ('customers', 'customers'),
      ('kiosks', 'kiosks'),
      ('payments', 'payments'),
      ('categories', 'categories'),
      ('business_types', 'business-types'),
      ('registration_requests', 'registration-requests'),
      ('settings', 'settings')
    ) as rules(table_name, permission_name)
  loop
    execute format('alter table public.%I enable row level security', access_rule.table_name);
    execute format('drop policy if exists task08_authenticated_baseline on public.%I', access_rule.table_name);
    execute format('drop policy if exists task08_active_permission_guard on public.%I', access_rule.table_name);
    execute format(
      'create policy task08_authenticated_baseline on public.%I as permissive for all to authenticated using (true) with check (true)',
      access_rule.table_name
    );
    execute format(
      'create policy task08_active_permission_guard on public.%I as restrictive for all to authenticated using ((select public.has_active_permission(%L))) with check ((select public.has_active_permission(%L)))',
      access_rule.table_name,
      access_rule.permission_name,
      access_rule.permission_name
    );
  end loop;
end;
$block$;

create or replace function public.get_current_staff_profile()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  profile public.user_roles%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Bạn phải đăng nhập.' using errcode = '42501';
  end if;

  select *
  into profile
  from public.user_roles ur
  where ur.user_id = auth.uid();

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'user_id', profile.user_id,
    'username', profile.username,
    'display_name', profile.display_name,
    'role', profile.role,
    'is_active', profile.is_active
  );
end;
$function$;

create or replace function public.get_my_permissions()
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  profile public.user_roles%rowtype;
  result text[];
begin
  if auth.uid() is null then
    raise exception 'Bạn phải đăng nhập.' using errcode = '42501';
  end if;

  select *
  into profile
  from public.user_roles ur
  where ur.user_id = auth.uid()
    and ur.is_active = true;
  if not found then
    raise exception 'Tài khoản chưa được cấp quyền hoặc đã bị khóa.'
      using errcode = '42501';
  end if;

  if lower(profile.role) = 'admin' then
    return array['*']::text[];
  end if;

  select coalesce(rp.permissions, array[]::text[])
  into result
  from public.role_permissions rp
  where lower(rp.role) = lower(profile.role);

  result := coalesce(result, array[]::text[]);
  if lower(profile.role) <> 'admin' then
    result := array_remove(array_remove(result, 'staff'), 'permissions');
  end if;
  return result;
end;
$function$;

create or replace function public.get_role_permissions_admin(role_input text)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  result text[];
begin
  perform private.assert_active_admin();
  select coalesce(rp.permissions, array[]::text[])
  into result
  from public.role_permissions rp
  where lower(rp.role) = lower(trim(role_input));
  return coalesce(result, array[]::text[]);
end;
$function$;

create or replace function public.update_reviewer_permissions(
  permissions_input text[],
  reason_input text default 'Cập nhật quyền Reviewer'
)
returns text[]
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor public.user_roles%rowtype;
  old_permissions text[];
  normalized_permissions text[];
  allowed_permissions constant text[] := array[
    'dashboard',
    'reports',
    'customers',
    'kiosks',
    'legacy-registration',
    'payments',
    'categories',
    'business-types',
    'registration-requests',
    'logs'
  ];
begin
  actor := private.assert_active_admin();

  select coalesce(rp.permissions, array[]::text[])
  into old_permissions
  from public.role_permissions rp
  where lower(rp.role) = 'reviewer';

  select coalesce(array_agg(distinct permission order by permission), array[]::text[])
  into normalized_permissions
  from unnest(coalesce(permissions_input, array[]::text[])) permission
  where permission = any(allowed_permissions);

  insert into public.role_permissions(role, permissions)
  values('reviewer', normalized_permissions)
  on conflict (role) do update
  set permissions = excluded.permissions;

  insert into public.audit_logs(
    actor_id,
    actor_name,
    actor_type,
    actor_role,
    module,
    entity,
    record_id,
    action,
    before,
    after,
    reason
  )
  values(
    actor.user_id,
    coalesce(actor.display_name, actor.username, 'Admin'),
    'staff',
    actor.role,
    'Permissions',
    'role_permissions',
    'reviewer',
    'update',
    jsonb_build_object('role', 'reviewer', 'permissions', coalesce(old_permissions, array[]::text[])),
    jsonb_build_object('role', 'reviewer', 'permissions', normalized_permissions),
    coalesce(nullif(trim(reason_input), ''), 'Cập nhật quyền Reviewer')
  );

  return normalized_permissions;
end;
$function$;

create or replace function private.prevent_staff_history_delete()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  raise exception 'Nhân viên không được xóa cứng. Hãy vô hiệu hóa tài khoản.'
    using errcode = '23514';
end;
$function$;

drop trigger if exists prevent_staff_history_delete_trigger on public.user_roles;
create trigger prevent_staff_history_delete_trigger
before delete on public.user_roles
for each row execute function private.prevent_staff_history_delete();

revoke all on function public.get_current_staff_profile() from public, anon, authenticated;
grant execute on function public.get_current_staff_profile() to authenticated;

revoke all on function public.get_my_permissions() from public, anon, authenticated;
grant execute on function public.get_my_permissions() to authenticated;

revoke all on function public.get_role_permissions_admin(text) from public, anon, authenticated;
grant execute on function public.get_role_permissions_admin(text) to authenticated;

revoke all on function public.update_reviewer_permissions(text[], text) from public, anon, authenticated;
grant execute on function public.update_reviewer_permissions(text[], text) to authenticated;

revoke all on function public.has_active_permission(text) from public, anon, authenticated;
grant execute on function public.has_active_permission(text) to authenticated;
