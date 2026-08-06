create table if not exists public.role_permissions (
  role text primary key,
  permissions text[] not null default '{}'::text[]
);

insert into public.role_permissions(role, permissions)
values
  ('admin', array[
    'dashboard',
    'reports',
    'customers',
    'customer-detail',
    'kiosks',
    'kiosk-detail',
    'payments',
    'payment-detail',
    'categories',
    'business-types',
    'registration-requests',
    'legacy-registration',
    'staff',
    'logs',
    'settings',
    'permissions',
    'admin-ttc',
    'user',
    'ttc'
  ]),
  ('reviewer', array[
    'dashboard',
    'reports',
    'customers',
    'customer-detail',
    'kiosks',
    'kiosk-detail',
    'payments',
    'payment-detail',
    'registration-requests',
    'legacy-registration',
    'logs',
    'admin-ttc'
  ]),
  ('support', array['dashboard'])
on conflict (role) do nothing;

update public.role_permissions rp
set permissions = (
  select array_agg(distinct permission order by permission)
  from unnest(coalesce(rp.permissions, '{}'::text[]) || seed.permissions) as permission
)
from (
  values
    ('admin'::text, array['admin-ttc', 'user', 'ttc']::text[]),
    ('reviewer'::text, array['admin-ttc']::text[]),
    ('support'::text, array['dashboard']::text[])
) as seed(role, permissions)
where lower(rp.role) = seed.role;
