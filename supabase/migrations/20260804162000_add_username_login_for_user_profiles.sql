alter table public.user_profiles
  add column if not exists username text;

update public.user_profiles
set username = lower(split_part(email, '@', 1))
where username is null
  and email is not null
  and lower(split_part(email, '@', 1)) ~ '^[a-z0-9._-]{3,40}$'
  and not exists (
    select 1
    from public.user_profiles existing
    where existing.user_id <> user_profiles.user_id
      and lower(existing.username) = lower(split_part(user_profiles.email, '@', 1))
  );

create unique index if not exists user_profiles_username_unique_idx
  on public.user_profiles (lower(username))
  where username is not null;

create index if not exists user_profiles_phone_login_idx
  on public.user_profiles (phone)
  where phone is not null;

create or replace function public.ensure_my_user_profile(
  display_name_input text default null,
  phone_input text default null,
  email_input text default null,
  metadata_input jsonb default '{}'::jsonb,
  username_input text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  profile_record public.user_profiles%rowtype;
  wallet_record public.wallets%rowtype;
  normalized_display_name text := nullif(trim(display_name_input), '');
  normalized_phone text := nullif(trim(phone_input), '');
  normalized_email text := nullif(lower(trim(email_input)), '');
  normalized_username text := nullif(lower(trim(username_input)), '');
  next_status text;
begin
  if auth.uid() is null then
    raise exception 'Bạn phải đăng nhập để tạo hồ sơ.' using errcode = '42501';
  end if;
  if normalized_phone is not null and normalized_phone !~ '^\+?[0-9 .()-]{9,20}$' then
    raise exception 'Số điện thoại không hợp lệ.' using errcode = '22023';
  end if;
  if normalized_username is not null and normalized_username !~ '^[a-z0-9._-]{3,40}$' then
    raise exception 'Username không hợp lệ.' using errcode = '22023';
  end if;

  select *
  into profile_record
  from public.user_profiles
  where user_id = auth.uid()
  for update;

  if found and profile_record.status = 'locked' then
    raise exception 'Tài khoản user đã bị khóa.' using errcode = '42501';
  end if;

  next_status := case
    when normalized_display_name is not null and normalized_phone is not null then 'active'
    else 'pending_profile'
  end;

  insert into public.user_profiles(
    user_id,
    username,
    display_name,
    phone,
    email,
    status,
    metadata
  )
  values(
    auth.uid(),
    normalized_username,
    normalized_display_name,
    normalized_phone,
    normalized_email,
    next_status,
    coalesce(metadata_input, '{}'::jsonb)
  )
  on conflict (user_id) do update
  set
    username = coalesce(excluded.username, public.user_profiles.username),
    display_name = coalesce(excluded.display_name, public.user_profiles.display_name),
    phone = coalesce(excluded.phone, public.user_profiles.phone),
    email = coalesce(excluded.email, public.user_profiles.email),
    status = case
      when public.user_profiles.status = 'locked' then public.user_profiles.status
      when coalesce(excluded.display_name, public.user_profiles.display_name) is not null
        and coalesce(excluded.phone, public.user_profiles.phone) is not null then 'active'
      else 'pending_profile'
    end,
    metadata = coalesce(public.user_profiles.metadata, '{}'::jsonb) || coalesce(excluded.metadata, '{}'::jsonb),
    updated_at = now()
  returning * into profile_record;

  wallet_record := private.ensure_wallet(auth.uid());

  perform private.write_ttc_audit(
    'User',
    'ensure_profile',
    'user_profiles',
    profile_record.user_id::text,
    null,
    jsonb_build_object(
      'user_id', profile_record.user_id,
      'status', profile_record.status,
      'has_username', profile_record.username is not null,
      'has_phone', profile_record.phone is not null,
      'has_email', profile_record.email is not null
    ),
    'User cập nhật hồ sơ'
  );

  return jsonb_build_object(
    'profile', to_jsonb(profile_record),
    'wallet', to_jsonb(wallet_record)
  );
end;
$function$;

create or replace function public.get_current_app_profile()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  staff_record public.user_roles%rowtype;
  user_record public.user_profiles%rowtype;
  wallet_record public.wallets%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Bạn phải đăng nhập.' using errcode = '42501';
  end if;

  select *
  into staff_record
  from public.user_roles ur
  where ur.user_id = auth.uid();

  if found then
    return jsonb_build_object(
      'profile_type', 'staff',
      'user_id', staff_record.user_id,
      'username', staff_record.username,
      'display_name', staff_record.display_name,
      'role', staff_record.role,
      'is_active', staff_record.is_active
    );
  end if;

  select *
  into user_record
  from public.user_profiles up
  where up.user_id = auth.uid();

  if not found then
    return null;
  end if;

  select *
  into wallet_record
  from public.wallets w
  where w.user_id = auth.uid();

  return jsonb_build_object(
    'profile_type', 'user',
    'user_id', user_record.user_id,
    'username', coalesce(user_record.username, user_record.email),
    'display_name', user_record.display_name,
    'phone', user_record.phone,
    'email', user_record.email,
    'role', 'user',
    'status', user_record.status,
    'is_active', user_record.status = 'active',
    'wallet', case when wallet_record.user_id is null then null else to_jsonb(wallet_record) end
  );
end;
$function$;

revoke all on function public.ensure_my_user_profile(text, text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.ensure_my_user_profile(text, text, text, jsonb, text) to authenticated;
