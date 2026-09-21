
-- Unified per-user web access foundation.
-- Additive and backwards-compatible: legacy user_roles/role_permissions remain intact.

create table if not exists public.app_permissions (
  permission text primary key,
  display_name text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint app_permissions_key_check
    check (permission = lower(btrim(permission)) and permission ~ '^[a-z0-9][a-z0-9-]*$')
);

insert into public.app_permissions(permission, display_name, sort_order)
values
  ('dashboard', 'Quản lý thống kê', 10),
  ('reports', 'Quản lý báo cáo', 20),
  ('customers', 'Quản lý khách hàng', 30),
  ('customer-detail', 'Chi tiết khách hàng', 31),
  ('kiosks', 'Quản lý Kiosk', 40),
  ('kiosk-detail', 'Chi tiết Kiosk', 41),
  ('legacy-registration', 'Quản lý dữ liệu cũ', 50),
  ('payments', 'Quản lý giao dịch', 60),
  ('payment-detail', 'Chi tiết giao dịch', 61),
  ('sources', 'Quản lý nguồn', 70),
  ('categories', 'Quản lý danh mục', 80),
  ('business-types', 'Quản lý ngành', 90),
  ('registration-requests', 'Quản lý đơn đăng ký', 100),
  ('ttc', 'Quản lý TTC', 110),
  ('services', 'Quản lý dịch vụ', 120),
  ('notifications', 'Quản lý thông báo', 130),
  ('tasks', 'Quản lý nhiệm vụ', 140),
  ('user-management', 'Quản lý người dùng', 150),
  ('wallet', 'Quản lý ví xu', 160),
  ('pricing', 'Quản lý bảng giá', 170),
  ('violations', 'Quản lý vi phạm', 180),
  ('logs', 'Quản lý nhật ký', 190),
  ('settings', 'Cài đặt hệ thống', 200),
  ('admin-ttc', 'Quản trị TTC', 210)
on conflict (permission) do update
set display_name = excluded.display_name,
    sort_order = excluded.sort_order;

alter table public.app_permissions enable row level security;

revoke all on table public.app_permissions from public, anon;
grant select on table public.app_permissions to authenticated;
grant all on table public.app_permissions to service_role;

drop policy if exists app_permissions_authenticated_read on public.app_permissions;
create policy app_permissions_authenticated_read
on public.app_permissions
for select
to authenticated
using (is_active = true);

alter table public.user_profiles
  add column if not exists web_access_enabled boolean not null default false,
  add column if not exists is_system_admin boolean not null default false,
  add column if not exists web_access_updated_at timestamptz,
  add column if not exists web_access_updated_by uuid references auth.users(id) on delete set null;

-- Ensure the canonical admin is represented in the unified profile table.
insert into public.user_profiles (
  user_id, username, display_name, email, status, metadata,
  web_access_enabled, is_system_admin, web_access_updated_at
)
select
  ur.user_id,
  'admin',
  ur.display_name,
  au.email,
  'active',
  jsonb_build_object('profile_source', 'legacy_admin_migration'),
  true,
  true,
  now()
from public.user_roles ur
join auth.users au on au.id = ur.user_id
where lower(ur.username) = 'admin'
  and lower(ur.role) = 'admin'
order by ur.created_at
limit 1
on conflict (user_id) do update
set username = 'admin',
    display_name = coalesce(public.user_profiles.display_name, excluded.display_name),
    email = coalesce(public.user_profiles.email, excluded.email),
    status = 'active',
    web_access_enabled = true,
    is_system_admin = true,
    web_access_updated_at = now(),
    metadata = coalesce(public.user_profiles.metadata, '{}'::jsonb)
      || jsonb_build_object('profile_source', 'legacy_admin_migration');

-- Safety: no non-canonical account becomes a system administrator.
update public.user_profiles
set is_system_admin = false,
    web_access_enabled = false,
    web_access_updated_at = now()
where user_id <> (
  select ur.user_id
  from public.user_roles ur
  where lower(ur.username) = 'admin'
    and lower(ur.role) = 'admin'
  order by ur.created_at
  limit 1
)
and (is_system_admin or web_access_enabled);

create table if not exists public.user_permissions (
  user_id uuid not null references public.user_profiles(user_id) on delete cascade,
  permission text not null references public.app_permissions(permission) on update cascade on delete restrict,
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (user_id, permission)
);

create index if not exists user_permissions_permission_idx
  on public.user_permissions(permission);

alter table public.user_permissions enable row level security;

revoke all on table public.user_permissions from public, anon, authenticated;
grant select on table public.user_permissions to authenticated;
grant all on table public.user_permissions to service_role;

create or replace function public.is_system_admin()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.user_profiles up
    where up.user_id = (select auth.uid())
      and up.status = 'active'
      and up.web_access_enabled
      and up.is_system_admin
  );
$$;

revoke all on function public.is_system_admin() from public, anon;
grant execute on function public.is_system_admin() to authenticated, service_role;

create or replace function public.has_user_permission(permission_input text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.user_profiles up
    where up.user_id = (select auth.uid())
      and up.status = 'active'
      and up.web_access_enabled
      and (
        up.is_system_admin
        or exists (
          select 1
          from public.user_permissions user_permission
          where user_permission.user_id = up.user_id
            and user_permission.permission = lower(btrim(permission_input))
        )
      )
  );
$$;

revoke all on function public.has_user_permission(text) from public, anon;
grant execute on function public.has_user_permission(text) to authenticated, service_role;

drop policy if exists user_permissions_read_own_or_admin on public.user_permissions;
create policy user_permissions_read_own_or_admin
on public.user_permissions
for select
to authenticated
using (
  user_id = (select auth.uid())
  or (select public.is_system_admin())
);

create or replace function public.get_my_access_profile()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce((
    select jsonb_build_object(
      'user_id', up.user_id,
      'username', up.username,
      'display_name', up.display_name,
      'email', up.email,
      'phone', up.phone,
      'status', up.status,
      'web_access_enabled', up.web_access_enabled,
      'is_system_admin', up.is_system_admin,
      'permissions',
        case
          when up.is_system_admin then coalesce((
            select jsonb_agg(ap.permission order by ap.sort_order, ap.permission)
            from public.app_permissions ap
            where ap.is_active
          ), '[]'::jsonb)
          else coalesce((
            select jsonb_agg(user_permission.permission order by ap.sort_order, user_permission.permission)
            from public.user_permissions user_permission
            join public.app_permissions ap on ap.permission = user_permission.permission
            where user_permission.user_id = up.user_id
              and ap.is_active
          ), '[]'::jsonb)
        end
    )
    from public.user_profiles up
    where up.user_id = (select auth.uid())
  ), '{}'::jsonb);
$$;

revoke all on function public.get_my_access_profile() from public, anon;
grant execute on function public.get_my_access_profile() to authenticated, service_role;

-- Allow the canonical admin to read profiles and permissions through RLS,
-- while retaining existing TTC self-service and legacy compatibility policies.
drop policy if exists user_profiles_system_admin_read on public.user_profiles;
create policy user_profiles_system_admin_read
on public.user_profiles
for select
to authenticated
using ((select public.is_system_admin()));

drop policy if exists user_permissions_system_admin_read on public.user_permissions;
create policy user_permissions_system_admin_read
on public.user_permissions
for select
to authenticated
using ((select public.is_system_admin()));

comment on table public.app_permissions is
  'Canonical registry of web modules/actions that can be granted per user.';
comment on table public.user_permissions is
  'Direct per-user web permissions. Mutations are server-side only.';
comment on column public.user_profiles.web_access_enabled is
  'Whether this TTC user may enter the administrative web application.';
comment on column public.user_profiles.is_system_admin is
  'Protected canonical administrator flag; never derived from user_metadata.';
;
