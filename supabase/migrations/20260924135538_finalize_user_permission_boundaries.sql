-- Prompt 3: authorization only. Keep financial/promotion/Employee bodies intact.
-- Review before applying. No business rows are rewritten by this migration.
begin;

-- An own-row policy must not allow a user to promote or reactivate themselves.
revoke insert, update, delete on public.user_profiles from authenticated;
grant update(display_name, phone, email) on public.user_profiles to authenticated;

create or replace function public.has_user_permission(permission_input text)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
  select exists(select 1 from public.user_profiles up
    where up.user_id=(select auth.uid()) and up.status='active' and up.web_access_enabled
      and (up.is_system_admin or exists(
        select 1 from public.user_permissions p join public.app_permissions a on a.permission=p.permission
        where p.user_id=up.user_id and p.permission=lower(btrim(permission_input)) and a.is_active)));
$$;

-- Preserve legacy signatures for their callers; authorization is canonical.
create or replace function public.has_active_staff_permission(permission_input text default null)
returns boolean language sql stable security definer set search_path='' as $$
  select public.has_user_permission(permission_input);
$$;
create or replace function public.has_active_permission(permission_input text)
returns boolean language sql stable security definer set search_path='' as $$
  select public.has_user_permission(permission_input);
$$;
create or replace function private.current_user_role()
returns text language sql stable security definer set search_path='' as $$
  select case when public.is_system_admin() then 'admin'::text else null::text end;
$$;
create or replace function public.is_active_promotion_admin()
returns boolean language sql stable security definer set search_path='' as $$
  select public.is_system_admin();
$$;

-- Return the historical actor shape without creating legacy staff/domain rows.
create or replace function private.assert_crm_permission(permission_input text)
returns public.user_roles language plpgsql stable security definer set search_path='' as $$
declare actor public.user_roles%rowtype;
begin
  if not public.has_user_permission(permission_input) then
    raise exception 'Bạn không có quyền thực hiện thao tác này.' using errcode='42501';
  end if;
  select up.user_id,up.username,coalesce(up.display_name,up.username),
    case when up.is_system_admin then 'admin' else 'staff' end,true,up.created_at,up.updated_at
  into actor from public.user_profiles up where up.user_id=(select auth.uid());
  return actor;
end;
$$;
create or replace function private.assert_active_admin()
returns public.user_roles language plpgsql stable security definer set search_path='' as $$
begin
  if not public.is_system_admin() then
    raise exception 'Chỉ quản trị hệ thống đang hoạt động được thực hiện thao tác này.' using errcode='42501';
  end if;
  return private.assert_crm_permission(null);
end;
$$;
create or replace function private.assert_ttc_staff(permission_input text default 'admin-ttc')
returns public.user_roles language plpgsql stable security definer set search_path='' as $$
begin return private.assert_crm_permission(permission_input); end;
$$;

create or replace function public.get_my_permissions()
returns text[] language plpgsql stable security definer set search_path='' as $$
begin
  if not exists(select 1 from public.user_profiles p where p.user_id=auth.uid() and p.status='active' and p.web_access_enabled) then
    raise exception 'Tài khoản không có quyền truy cập web.' using errcode='42501';
  end if;
  if public.is_system_admin() then return array['*']::text[]; end if;
  return array(select p.permission from public.user_permissions p join public.app_permissions a using(permission)
    where p.user_id=auth.uid() and a.is_active order by p.permission);
end;
$$;

-- These permissive policies otherwise OR a legacy reviewer role into canonical RLS.
drop policy if exists "Active staff read registration requests" on public.registration_requests;
drop policy if exists "Active staff update registration requests" on public.registration_requests;

-- Public registration/lookup/renewal use validated RPC/API paths, not raw CRM rows.
drop policy if exists "Extension can read kiosks" on public.kiosks;
revoke select on public.kiosks from anon;

-- Change only audited authorization blocks in existing large business functions.
-- Fail closed if an unexpected deployed definition cannot be matched.
do $guards$
declare original text; changed text;
begin
  original:=pg_get_functiondef('public.get_dashboard_data(integer,integer)'::regprocedure);
  changed:=regexp_replace(original,
    'if auth\.uid\(\) is null or not exists \([\s\S]*?raise exception ''Không có quyền xem Dashboard\.''[\s\S]*?end if;',
    'if not public.has_user_permission(''dashboard'') then raise exception ''Không có quyền xem Dashboard.'' using errcode = ''42501''; end if;');
  if changed=original then raise exception 'Unexpected Dashboard authorization definition'; end if;
  execute changed;

  original:=pg_get_functiondef('public.admin_save_promotion(bigint,jsonb,bigint[],bigint[])'::regprocedure);
  changed:=regexp_replace(original,
    'if not exists \([\s\S]*?raise exception ''Bạn không có quyền quản lý mã giảm giá\.''[\s\S]*?end if;',
    'if not public.is_system_admin() then raise exception ''Bạn không có quyền quản lý mã giảm giá.'' using errcode = ''42501''; end if;');
  if changed=original then raise exception 'Unexpected promotion authorization definition'; end if;
  execute changed;

  original:=pg_get_functiondef('public.reject_registration_request(bigint,text)'::regprocedure);
  changed:=regexp_replace(original,
    'actor_role := private\.current_user_role\(\);[\s\S]*?end if;',
    'perform private.assert_registration_permission();');
  if changed=original then raise exception 'Unexpected registration rejection authorization definition'; end if;
  execute changed;

  original:=pg_get_functiondef('public.get_organization_settings()'::regprocedure);
  changed:=replace(original,'private.assert_active_admin()','private.assert_crm_permission(''settings'')');
  if changed=original then raise exception 'Unexpected settings read authorization definition'; end if;
  execute changed;
  original:=pg_get_functiondef('public.update_organization_settings(jsonb,text)'::regprocedure);
  changed:=replace(original,'private.assert_active_admin()','private.assert_crm_permission(''settings'')');
  if changed=original then raise exception 'Unexpected settings write authorization definition'; end if;
  execute changed;

  original:=pg_get_functiondef('public.write_audit_log(text,text,text,text,jsonb,jsonb,text)'::regprocedure);
  changed:=regexp_replace(original,
    'if auth\.uid\(\) is null then[\s\S]*?if not found then[\s\S]*?end if;',
    $guard$actor := private.assert_crm_permission(case lower(module_input)
      when 'customer' then case when public.has_user_permission('customers') then 'customers' else 'customer-detail' end
      when 'kiosk' then case when public.has_user_permission('kiosks') then 'kiosks' else 'kiosk-detail' end
      when 'payment' then 'payments' else null end);$guard$);
  if changed=original then raise exception 'Unexpected audit writer authorization definition'; end if;
  execute changed;
end;
$guards$;

-- Restore the original approval body lost by the 20260916124500 guard regex.
-- Exact 20260731110000 behavior, with only the canonical assertion substituted.
create or replace function public.approve_registration_request(request_id_input bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor public.user_roles%rowtype;
  request_record public.registration_requests%rowtype;
  before_record public.registration_requests%rowtype;
  payment_id_value bigint;
  payment_record public.payments%rowtype;
begin
  actor := private.assert_registration_permission();

  select *
  into request_record
  from public.registration_requests
  where id = request_id_input
  for update;

  if not found then
    raise exception 'Không tìm thấy đơn đăng ký.';
  end if;
  if lower(request_record.status) <> 'pending' then
    raise exception 'Chỉ đơn Pending mới được duyệt.';
  end if;

  before_record := request_record;
  payment_id_value := private.registration_request_payment(request_record);

  select *
  into payment_record
  from public.payments
  where id = payment_id_value
  for update;

  if not found then
    raise exception 'Không tìm thấy thanh toán của đơn đăng ký.';
  end if;
  if lower(coalesce(payment_record.payment_status, '')) <> 'pending' then
    raise exception 'Chỉ duyệt hồ sơ khi thanh toán đang Pending.' using errcode = '22023';
  end if;

  update public.registration_requests
  set
    payment_id = payment_id_value,
    status = 'approved',
    reviewed_at = pg_catalog.now(),
    reviewed_by = actor.user_id,
    rejection_reason = null
  where id = request_record.id
  returning * into request_record;

  insert into public.audit_logs(
    actor_id, actor_name, actor_type, actor_role, module, entity,
    record_id, action, before, after, reason
  )
  values(
    actor.user_id,
    coalesce(actor.display_name, actor.username, 'System'),
    'staff',
    actor.role,
    'Registration',
    'registration_requests',
    request_record.id::text,
    'approve_profile_pending_payment',
    to_jsonb(before_record),
    to_jsonb(request_record),
    'Duyệt hồ sơ đăng ký, giữ thanh toán Pending để khách chuyển khoản/PayOS'
  );

  return jsonb_build_object(
    'request', to_jsonb(request_record),
    'payment', to_jsonb(payment_record)
  );
end;
$function$;

-- These existing TTC user operations require the same explicit key as their routes.
-- No campaign, wallet or task calculation is changed.
do $ttc_guards$
declare target regprocedure; original text; changed text;
begin
  for target in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('create_ttc_campaign','claim_ttc_task','submit_ttc_task','cancel_ttc_campaign','enqueue_ttc_verify_job','list_available_ttc_tasks','list_my_ttc_tasks')
  loop
    original:=pg_get_functiondef(target);
    changed:=regexp_replace(original,'\mbegin\M',
      E'begin\n  if not public.has_user_permission(''ttc'') and not public.has_user_permission(''admin-ttc'') then raise exception ''Không có quyền truy cập TTC.'' using errcode=''42501''; end if;', 'i');
    if changed=original then raise exception 'Unexpected TTC authorization definition: %',target; end if;
    execute changed;
  end loop;
end;
$ttc_guards$;

-- Personal wallet access still needs an active account. CRM order reservation
-- must use payments even when called directly, matching the PayOS API guard.
do $wallet_guards$
declare target regprocedure; original text; changed text;
begin
  for target in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('get_my_wallet','get_my_wallet_ledger','record_payos_payment_link')
  loop
    original:=pg_get_functiondef(target);
    changed:=regexp_replace(original,'\mbegin\M',
      E'begin\n  if not exists(select 1 from public.user_profiles p where p.user_id=auth.uid() and p.status=''active'' and p.web_access_enabled) then raise exception ''Tài khoản không có quyền truy cập web.'' using errcode=''42501''; end if;', 'i');
    if changed=original then raise exception 'Unexpected wallet authorization definition: %',target; end if;
    if target::text like 'record_payos_payment_link(%' or target::text like 'public.record_payos_payment_link(%' then
      changed:=replace(changed,'if not private.current_staff_has_payos_access() then',
        'if not public.has_user_permission(''payments'') then');
    end if;
    execute changed;
  end loop;
end;
$wallet_guards$;

-- A browser role cannot invoke internal mutation helpers directly.
revoke execute on all functions in schema private from public,anon,authenticated;
grant execute on function private.current_user_role() to authenticated;
revoke all on function private.assert_crm_permission(text) from public,anon,authenticated;
revoke all on function public.has_user_permission(text),public.has_active_staff_permission(text),
  public.has_active_permission(text),public.is_active_promotion_admin(),public.get_my_permissions() from public,anon;
grant execute on function public.has_user_permission(text),public.has_active_staff_permission(text),
  public.has_active_permission(text),public.is_active_promotion_admin(),public.get_my_permissions() to authenticated,service_role;
commit;
