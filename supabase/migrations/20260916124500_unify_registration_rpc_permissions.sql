-- QA Round 1: make registration RPC authorization follow the unified module
-- permission used by the router and sidebar. Business bodies remain unchanged.
begin;

create or replace function private.assert_registration_permission()
returns public.user_roles
language plpgsql
stable
security definer
set search_path = ''
as $$
declare actor public.user_roles%rowtype;
begin
  if not public.has_user_permission('registration-requests') then
    raise exception 'Không có quyền xử lý hồ sơ đăng ký.' using errcode = '42501';
  end if;
  select up.user_id, up.username, coalesce(up.display_name, up.username),
    case when up.is_system_admin then 'admin' else 'staff' end, true,
    up.created_at, up.updated_at
  into actor
  from public.user_profiles up
  where up.user_id = auth.uid();
  if not found then
    raise exception 'Không tìm thấy hồ sơ người dùng.' using errcode = '42501';
  end if;
  return actor;
end;
$$;
revoke all on function private.assert_registration_permission() from public;

do $migration$
declare
  target regprocedure;
  signature text;
  definition text;
  changed text;
begin
  target := to_regprocedure('public.approve_registration_request(bigint)');
  if target is not null then
    select pg_get_functiondef(target) into definition;
    changed := regexp_replace(
      definition,
      'actor := private\.assert_payment_permission\(\);\s+if lower\(actor\.role\) <> ''admin''[\s\S]*?end if;',
      'actor := private.assert_registration_permission();'
    );
    if changed = definition then
      raise exception 'approve_registration_request authorization guard did not match expected definition.';
    end if;
    execute changed;
  end if;

  foreach signature in array array[
    'public.admin_list_registration_requests(text)',
    'public.admin_complete_awaiting_registration(bigint,text)',
    'public.admin_cancel_awaiting_registration(bigint,text)'
  ] loop
    target := to_regprocedure(signature);
    continue when target is null;
    select pg_get_functiondef(target) into definition;
    changed := regexp_replace(
      definition,
      'if auth\.uid\(\) is null or not exists \([\s\S]*?\) then\s+raise exception ''[^'']*'' using errcode = ''42501'';\s+end if;',
      'perform private.assert_registration_permission();'
    );
    if changed = definition then
      raise exception '% authorization guard did not match expected definition.', target::text;
    end if;
    execute changed;
  end loop;

  target := to_regprocedure('public.review_public_legacy_registration_request(bigint,text,text)');
  if target is not null then
    select pg_get_functiondef(target) into definition;
    changed := regexp_replace(
      definition,
      'if auth\.uid\(\) is null then[\s\S]*?end if;\s+select \*\s+into actor[\s\S]*?if not found then\s+raise exception ''Không có quyền xử lý yêu cầu bổ sung\.'' using errcode = ''42501'';\s+end if;',
      'actor := private.assert_registration_permission();'
    );
    if changed = definition then
      raise exception 'review_public_legacy_registration_request authorization guard did not match expected definition.';
    end if;
    execute changed;
  end if;
end
$migration$;

commit;
