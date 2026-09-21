create table public.role_permissions (
  role text primary key,
  permissions text[] not null
);

insert into public.role_permissions (role, permissions) values
('reviewer', array[
  'dashboard',
  'kiosks',
  'kiosk-detail',
  'customers',
  'customer-detail',
  'payments',
  'payment-detail',
  'registration-requests',
  'reports',
  'logs'
]);

alter table public.role_permissions enable row level security;
revoke all on table public.role_permissions from public, anon, authenticated;

create table public.settings (
  key text primary key,
  value text
);

insert into public.settings (key, value) values
('group_url', ''),
('sub_group_url', ''),
('recruitment_group_url', ''),
('fanpage_url', ''),
('zalo_url', ''),
('support_phone', ''),
('warning_days', '30'),
('company_info', ''),
('business_info', ''),
('system_settings', '');

alter table public.settings enable row level security;
revoke all on table public.settings from public, anon, authenticated;

notify pgrst, 'reload schema';;
