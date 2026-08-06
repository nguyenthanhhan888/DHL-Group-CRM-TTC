insert into public.settings(key, value)
values
  ('official_group_name', ''),
  ('facebook_group_id', '')
on conflict (key) do nothing;

create or replace function public.get_public_organization_settings()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(jsonb_object_agg(s.key, coalesce(s.value, '')), '{}'::jsonb)
  from public.settings s
  where s.key = any(array[
    'official_group_name',
    'group_url',
    'sub_group_url',
    'recruitment_group_url',
    'fanpage_url',
    'zalo_url',
    'support_phone',
    'facebook_group_id'
  ]);
$function$;

create or replace function public.get_organization_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  result jsonb;
begin
  perform private.assert_active_admin();
  select coalesce(jsonb_object_agg(s.key, coalesce(s.value, '')), '{}'::jsonb)
  into result
  from public.settings s;
  return result;
end;
$function$;

create or replace function public.update_organization_settings(
  settings_input jsonb,
  reason_input text default 'Cập nhật cài đặt tổ chức'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor public.user_roles%rowtype;
  allowed_keys constant text[] := array[
    'official_group_name',
    'group_url',
    'sub_group_url',
    'recruitment_group_url',
    'fanpage_url',
    'zalo_url',
    'support_phone',
    'facebook_group_id',
    'warning_days',
    'company_info',
    'business_info',
    'system_settings'
  ];
  url_keys constant text[] := array[
    'group_url',
    'sub_group_url',
    'recruitment_group_url',
    'fanpage_url'
  ];
  setting_key text;
  setting_value text;
  old_values jsonb;
  new_values jsonb;
  warning_days integer;
begin
  actor := private.assert_active_admin();
  if settings_input is null or jsonb_typeof(settings_input) <> 'object' then
    raise exception 'Dữ liệu cài đặt không hợp lệ.' using errcode = '22023';
  end if;

  if exists (
    select 1 from jsonb_object_keys(settings_input) supplied_key
    where supplied_key <> all(allowed_keys)
  ) then
    raise exception 'Có khóa cài đặt không được phép.' using errcode = '22023';
  end if;

  if nullif(trim(settings_input ->> 'official_group_name'), '') is null then
    raise exception 'Tên nhóm chính thức là bắt buộc.' using errcode = '22023';
  end if;

  foreach setting_key in array url_keys loop
    setting_value := nullif(trim(settings_input ->> setting_key), '');
    if setting_value is not null and setting_value !~* '^https?://[^[:space:]]+$' then
      raise exception '% phải là URL HTTP hoặc HTTPS hợp lệ.', setting_key using errcode = '22023';
    end if;
  end loop;

  setting_value := nullif(trim(settings_input ->> 'facebook_group_id'), '');
  if setting_value is not null and setting_value !~ '^[0-9]+$' then
    raise exception 'Facebook Group ID chỉ được chứa chữ số.' using errcode = '22023';
  end if;

  begin
    warning_days := (settings_input ->> 'warning_days')::integer;
  exception when others then
    raise exception 'Số ngày cảnh báo phải là số nguyên.' using errcode = '22023';
  end;
  if warning_days < 1 or warning_days > 365 then
    raise exception 'Số ngày cảnh báo phải từ 1 đến 365.' using errcode = '22023';
  end if;

  select coalesce(jsonb_object_agg(s.key, coalesce(s.value, '')), '{}'::jsonb)
  into old_values
  from public.settings s
  where s.key = any(allowed_keys);

  for setting_key, setting_value in
    select entry.key, trim(coalesce(entry.value, ''))
    from jsonb_each_text(settings_input) entry
    where entry.key = any(allowed_keys)
  loop
    insert into public.settings(key, value)
    values(setting_key, setting_value)
    on conflict (key) do update set value = excluded.value;
  end loop;

  select coalesce(jsonb_object_agg(s.key, coalesce(s.value, '')), '{}'::jsonb)
  into new_values
  from public.settings s
  where s.key = any(allowed_keys);

  insert into public.audit_logs(
    actor_id, actor_name, actor_type, actor_role, module, entity,
    record_id, action, before, after, reason
  )
  values(
    actor.user_id,
    coalesce(actor.display_name, actor.username, 'Admin'),
    'staff',
    actor.role,
    'Settings',
    'settings',
    'organization',
    'update',
    old_values,
    new_values,
    coalesce(nullif(trim(reason_input), ''), 'Cập nhật cài đặt tổ chức')
  );

  return new_values;
end;
$function$;

revoke insert, update, delete on table public.settings from public, anon, authenticated;

revoke all on function public.get_public_organization_settings() from public, anon, authenticated;
grant execute on function public.get_public_organization_settings() to anon, authenticated;

revoke all on function public.get_organization_settings() from public, anon, authenticated;
grant execute on function public.get_organization_settings() to authenticated;

revoke all on function public.update_organization_settings(jsonb, text) from public, anon, authenticated;
grant execute on function public.update_organization_settings(jsonb, text) to authenticated;
