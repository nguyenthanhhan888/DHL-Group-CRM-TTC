-- Prepared only. Do not apply without a separate deployment decision.
-- Dependency evidence: docs/qa/stabilization-consolidation/database-audit.json.
-- Preserve wallets/ledger + private.ensure_wallet/post_wallet_ledger for historical
-- PayOS orders, and private.write_ttc_audit for CRM/PayOS/promotion audit logging.
-- No CASCADE: unknown external schema dependencies must abort this transaction.
begin;
set local lock_timeout = '5s';

-- CRM profile has no wallet dependency; retain the response key for compatibility.
CREATE OR REPLACE FUNCTION public.ensure_my_user_profile(display_name_input text DEFAULT NULL::text, phone_input text DEFAULT NULL::text, email_input text DEFAULT NULL::text, metadata_input jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  profile_record public.user_profiles%rowtype;
  normalized_display_name text := nullif(trim(display_name_input), '');
  normalized_phone text := nullif(trim(phone_input), '');
  normalized_email text := nullif(lower(trim(email_input)), '');
  next_status text;
begin
  if auth.uid() is null then
    raise exception 'Bạn phải đăng nhập để tạo hồ sơ.' using errcode = '42501';
  end if;
  if normalized_phone is not null and normalized_phone !~ '^\+?[0-9 .()-]{9,20}$' then
    raise exception 'Số điện thoại không hợp lệ.' using errcode = '22023';
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
    display_name,
    phone,
    email,
    status,
    metadata
  )
  values(
    auth.uid(),
    normalized_display_name,
    normalized_phone,
    normalized_email,
    next_status,
    coalesce(metadata_input, '{}'::jsonb)
  )
  on conflict (user_id) do update
  set
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


  perform private.write_ttc_audit(
    'User',
    'ensure_profile',
    'user_profiles',
    profile_record.user_id::text,
    null,
    jsonb_build_object(
      'user_id', profile_record.user_id,
      'status', profile_record.status,
      'has_phone', profile_record.phone is not null,
      'has_email', profile_record.email is not null
    ),
    'User cập nhật hồ sơ'
  );

  return jsonb_build_object(
    'profile', to_jsonb(profile_record),
    'wallet', null
  );
end;
$function$
;

-- CRM profile has no wallet dependency; retain the response key for compatibility.
CREATE OR REPLACE FUNCTION public.ensure_my_user_profile(display_name_input text DEFAULT NULL::text, phone_input text DEFAULT NULL::text, email_input text DEFAULT NULL::text, metadata_input jsonb DEFAULT '{}'::jsonb, username_input text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  profile_record public.user_profiles%rowtype;
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
    'wallet', null
  );
end;
$function$
;

-- CRM profile has no wallet dependency; retain the response key for compatibility.
CREATE OR REPLACE FUNCTION public.get_current_app_profile()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  staff_record public.user_roles%rowtype;
  user_record public.user_profiles%rowtype;
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
      'is_active', staff_record.is_active,
      'created_at', staff_record.created_at
    );
  end if;

  select *
  into user_record
  from public.user_profiles up
  where up.user_id = auth.uid();

  if not found then
    return null;
  end if;


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
    'created_at', user_record.created_at,
    'updated_at', user_record.updated_at,
    'wallet', null
  );
end;
$function$
;

-- Remove TTC RPCs before their tables.
drop function if exists public.admin_create_ttc_campaign_for_user(owner_user_id_input uuid, interaction_type_input text, target_url_input text, target_quantity_input integer, idempotency_key_input text, target_facebook_id_input text, target_label_input text, comment_options_input jsonb, metadata_input jsonb, admin_reason_input text) restrict;
drop function if exists public.admin_post_wallet_ledger(wallet_user_id_input uuid, amount_input numeric, transaction_type_input text, related_table_input text, related_id_input text, idempotency_key_input text, description_input text, reason_input text, metadata_input jsonb) restrict;
drop function if exists public.admin_update_ttc_verify_job(job_id_input bigint, action_input text, reason_input text) restrict;
drop function if exists public.cancel_ttc_campaign(campaign_id_input bigint, reason_input text, idempotency_key_input text) restrict;
drop function if exists public.create_ttc_campaign(interaction_type_input text, target_url_input text, target_quantity_input integer, idempotency_key_input text, target_facebook_id_input text, target_label_input text, comment_options_input jsonb, metadata_input jsonb) restrict;
drop function if exists public.enqueue_ttc_verify_job(task_id_input bigint) restrict;
drop function if exists public.get_my_wallet() restrict;
drop function if exists public.list_available_ttc_tasks(facebook_account_id_input bigint, page_number integer, page_size integer) restrict;
drop function if exists public.submit_ttc_task(task_id_input bigint, evidence_input jsonb) restrict;
drop function if exists public.verify_ttc_task(task_id_input bigint, action_input text, reason_input text, metadata_input jsonb) restrict;
drop function if exists public.claim_ttc_task(campaign_id_input bigint, facebook_account_id_input bigint, idempotency_key_input text) restrict;
drop function if exists public.list_available_ttc_campaigns(facebook_account_id_input bigint, page_number integer, page_size integer) restrict;
drop function if exists public.get_my_wallet_ledger(page_number integer, page_size integer) restrict;
drop function if exists public.list_my_ttc_tasks(status_input text, page_number integer, page_size integer) restrict;
drop function if exists public.system_verify_ttc_task(task_id_input bigint, metadata_input jsonb) restrict;
drop function if exists private.assert_ttc_staff(permission_input text) restrict;

-- PL/pgSQL text references are not all represented by pg_depend. Fail closed if
-- another function still mentions the exact TTC table names after RPC removal.
do $check$
declare dependency text;
begin
  select n.nspname || '.' || p.proname into dependency
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','private') and p.prokind='f'
    and p.prosrc ~ '\m(ttc_campaigns|ttc_checker_accounts|ttc_checker_sessions|ttc_interaction_types|ttc_job_matches|ttc_target_scans|ttc_task_check_logs|ttc_tasks|ttc_verify_jobs|admin_create_ttc_campaign_for_user|admin_post_wallet_ledger|admin_update_ttc_verify_job|cancel_ttc_campaign|create_ttc_campaign|enqueue_ttc_verify_job|get_my_wallet|list_available_ttc_tasks|submit_ttc_task|verify_ttc_task|claim_ttc_task|list_available_ttc_campaigns|get_my_wallet_ledger|list_my_ttc_tasks|system_verify_ttc_task|assert_ttc_staff)\M'
  limit 1;
  if dependency is not null then
    raise exception 'Cleanup stopped: retained function % references TTC tables', dependency;
  end if;
  if to_regclass('cron.job') is not null then
    execute $sql$select jobname from cron.job where command ~* '(ttc_|verify-facebook-task)' limit 1$sql$ into dependency;
    if dependency is not null then
      raise exception 'Cleanup stopped: scheduled job % requires separate review', dependency;
    end if;
  end if;
end;
$check$;

drop table if exists public.ttc_campaigns,
  public.ttc_checker_accounts,
  public.ttc_checker_sessions,
  public.ttc_interaction_types,
  public.ttc_job_matches,
  public.ttc_target_scans,
  public.ttc_task_check_logs,
  public.ttc_tasks,
  public.ttc_verify_jobs restrict;

-- Notifications is retained: it authorizes the CRM notification feed.
delete from public.user_permissions where permission in ('ttc','services','tasks','wallet','pricing','violations','admin-ttc');
update public.role_permissions r
set permissions = array(select p from unnest(r.permissions) as p
  where p not in ('ttc','services','tasks','wallet','pricing','violations','admin-ttc'))
where r.permissions && array['ttc','services','tasks','wallet','pricing','violations','admin-ttc']::text[];
delete from public.app_permissions where permission in ('ttc','services','tasks','wallet','pricing','violations','admin-ttc');

commit;
