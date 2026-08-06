create or replace function private.assert_customer_kiosk_permission(permission_input text)
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
    raise exception 'Bạn phải đăng nhập để quản lý khách hàng và Kiosk.'
      using errcode = '42501';
  end if;

  select *
  into actor
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
    );

  if not found then
    raise exception 'Không có quyền quản lý dữ liệu này.'
      using errcode = '42501';
  end if;

  return actor;
end;
$function$;

create or replace function private.prevent_customer_kiosk_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  raise exception '% không được xóa cứng. Hãy thay đổi trạng thái.', tg_table_name
    using errcode = '23514';
end;
$function$;

drop trigger if exists prevent_customer_hard_delete_trigger on public.customers;
create trigger prevent_customer_hard_delete_trigger
before delete on public.customers
for each row execute function private.prevent_customer_kiosk_delete();

drop trigger if exists prevent_kiosk_hard_delete_trigger on public.kiosks;
create trigger prevent_kiosk_hard_delete_trigger
before delete on public.kiosks
for each row execute function private.prevent_customer_kiosk_delete();

create or replace function private.validate_customer_status()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if lower(coalesce(new.status, '')) not in ('active', 'inactive') then
    raise exception 'Trạng thái khách hàng chỉ có Active hoặc Inactive.'
      using errcode = '23514';
  end if;
  new.status := lower(new.status);
  return new;
end;
$function$;

drop trigger if exists validate_customer_status_trigger on public.customers;
create trigger validate_customer_status_trigger
before insert or update of status on public.customers
for each row execute function private.validate_customer_status();

create or replace function private.validate_kiosk_status()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if lower(coalesce(new.status, '')) not in ('pending', 'active', 'expired', 'suspended') then
    raise exception 'Trạng thái Kiosk không hợp lệ.'
      using errcode = '23514';
  end if;
  new.status := lower(new.status);
  return new;
end;
$function$;

drop trigger if exists validate_kiosk_status_trigger on public.kiosks;
create trigger validate_kiosk_status_trigger
before insert or update of status on public.kiosks
for each row execute function private.validate_kiosk_status();

create or replace function private.enforce_kiosk_facebook_id()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  normalized_id text;
begin
  normalized_id := nullif(regexp_replace(coalesce(new.facebook_id, ''), '[^0-9]', '', 'g'), '');
  if normalized_id is null or normalized_id <> trim(coalesce(new.facebook_id, '')) then
    raise exception 'Facebook ID của Kiosk là bắt buộc và phải là dạng số.'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(normalized_id, 0));

  if exists (
    select 1
    from public.kiosks k
    where k.facebook_id = normalized_id
      and k.id <> coalesce(new.id, 0)
  ) or exists (
    select 1
    from public.registration_requests r
    where r.facebook_id = normalized_id
      and lower(coalesce(r.status, 'pending')) = 'pending'
      and r.kiosk_id is distinct from new.id
  ) then
    raise exception 'Facebook ID đã được sử dụng.'
      using errcode = '23505';
  end if;

  new.facebook_id := normalized_id;
  return new;
end;
$function$;

drop trigger if exists enforce_kiosk_facebook_id_trigger on public.kiosks;
create trigger enforce_kiosk_facebook_id_trigger
before insert or update of facebook_id on public.kiosks
for each row execute function private.enforce_kiosk_facebook_id();

create or replace function private.sync_customer_kiosk_counts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'UPDATE' and old.customer_id is distinct from new.customer_id then
    update public.customers c
    set total_kiosks = (
      select count(*)::integer from public.kiosks k where k.customer_id = old.customer_id
    )
    where c.id = old.customer_id;
  end if;

  update public.customers c
  set total_kiosks = (
    select count(*)::integer from public.kiosks k where k.customer_id = new.customer_id
  )
  where c.id = new.customer_id;

  return new;
end;
$function$;

drop trigger if exists sync_customer_kiosk_counts_trigger on public.kiosks;
create trigger sync_customer_kiosk_counts_trigger
after insert or update of customer_id on public.kiosks
for each row execute function private.sync_customer_kiosk_counts();

create or replace function private.protect_kiosk_customer_reassignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.customer_id is distinct from old.customer_id
    and coalesce(current_setting('app.kiosk_reassignment', true), '') <> 'confirmed' then
    raise exception 'Đổi khách hàng của Kiosk phải dùng reassign_kiosk_customer().'
      using errcode = '23514';
  end if;
  return new;
end;
$function$;

drop trigger if exists protect_kiosk_customer_reassignment_trigger on public.kiosks;
create trigger protect_kiosk_customer_reassignment_trigger
before update of customer_id on public.kiosks
for each row execute function private.protect_kiosk_customer_reassignment();

create or replace function public.reassign_kiosk_customer(
  kiosk_id_input bigint,
  new_customer_id_input bigint,
  confirmed_input boolean,
  reason_input text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor public.user_roles%rowtype;
  kiosk_record public.kiosks%rowtype;
  before_record public.kiosks%rowtype;
  new_customer public.customers%rowtype;
begin
  actor := private.assert_customer_kiosk_permission('kiosks');

  if confirmed_input is distinct from true then
    raise exception 'Cần xác nhận rõ việc đổi khách hàng của Kiosk.'
      using errcode = '22023';
  end if;
  if nullif(trim(reason_input), '') is null then
    raise exception 'Lý do đổi khách hàng là bắt buộc.'
      using errcode = '22023';
  end if;

  select * into kiosk_record
  from public.kiosks
  where id = kiosk_id_input
  for update;
  if not found then
    raise exception 'Không tìm thấy Kiosk.' using errcode = 'P0002';
  end if;

  before_record := kiosk_record;
  if kiosk_record.customer_id = new_customer_id_input then
    return jsonb_build_object('kiosk', to_jsonb(kiosk_record), 'changed', false);
  end if;

  select * into new_customer
  from public.customers
  where id = new_customer_id_input
  for update;
  if not found then
    raise exception 'Khách hàng mới không tồn tại.' using errcode = '23503';
  end if;

  perform 1 from public.customers where id = kiosk_record.customer_id for update;

  -- Pending transactions follow the kiosk to keep future confirmation valid.
  -- Completed/Rejected/Cancelled transactions retain their historical customer.
  perform set_config('app.payment_workflow_action', 'edit', true);
  update public.payments
  set customer_id = new_customer.id
  where kiosk_id = kiosk_record.id
    and lower(payment_status) = 'pending';

  perform set_config('app.kiosk_reassignment', 'confirmed', true);
  update public.kiosks
  set customer_id = new_customer.id
  where id = kiosk_record.id
  returning * into kiosk_record;

  insert into public.audit_logs(
    actor_id,
    actor_name,
    actor_role,
    module,
    action,
    before,
    after,
    reason
  )
  values(
    actor.user_id,
    coalesce(actor.display_name, actor.username, 'System'),
    actor.role,
    'Kiosk',
    'reassign_customer',
    to_jsonb(before_record),
    to_jsonb(kiosk_record),
    trim(reason_input)
  );

  return jsonb_build_object(
    'kiosk', to_jsonb(kiosk_record),
    'changed', true,
    'completedPaymentsPreserved', (
      select count(*) from public.payments p
      where p.kiosk_id = kiosk_record.id
        and lower(p.payment_status) = 'completed'
    )
  );
end;
$function$;

revoke all on function public.reassign_kiosk_customer(bigint, bigint, boolean, text)
  from public, anon, authenticated;
grant execute on function public.reassign_kiosk_customer(bigint, bigint, boolean, text)
  to authenticated;

create or replace function public.recalculate_customer_kiosk_totals(
  reason_input text default 'Đối chiếu lại tổng Customer/Kiosk'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor public.user_roles%rowtype;
  customer_count integer;
  kiosk_count integer;
begin
  actor := private.assert_customer_kiosk_permission('customers');
  if lower(actor.role) <> 'admin' and not exists (
    select 1
    from public.role_permissions rp
    where lower(rp.role) = lower(actor.role)
      and 'customers' = any(rp.permissions)
      and 'kiosks' = any(rp.permissions)
  ) then
    raise exception 'Cần quyền Customers và Kiosks để đối chiếu tổng.'
      using errcode = '42501';
  end if;

  update public.customers c
  set
    total_kiosks = (
      select count(*)::integer from public.kiosks k where k.customer_id = c.id
    ),
    total_paid = coalesce((
      select sum(p.total_amount)
      from public.payments p
      where p.customer_id = c.id
        and lower(p.payment_status) = 'completed'
        and p.confirmed_at is not null
    ), 0);
  get diagnostics customer_count = row_count;

  update public.kiosks k
  set total_paid = coalesce((
    select sum(p.total_amount)
    from public.payments p
    where p.kiosk_id = k.id
      and lower(p.payment_status) = 'completed'
      and p.confirmed_at is not null
  ), 0);
  get diagnostics kiosk_count = row_count;

  insert into public.audit_logs(
    actor_id,
    actor_name,
    actor_role,
    module,
    action,
    before,
    after,
    reason
  )
  values(
    actor.user_id,
    coalesce(actor.display_name, actor.username, 'System'),
    actor.role,
    'Customer/Kiosk',
    'recalculate_totals',
    null,
    jsonb_build_object(
      'customers_recalculated', customer_count,
      'kiosks_recalculated', kiosk_count
    ),
    coalesce(nullif(trim(reason_input), ''), 'Đối chiếu lại tổng Customer/Kiosk')
  );

  return jsonb_build_object(
    'customersRecalculated', customer_count,
    'kiosksRecalculated', kiosk_count
  );
end;
$function$;

revoke all on function public.recalculate_customer_kiosk_totals(text)
  from public, anon, authenticated;
grant execute on function public.recalculate_customer_kiosk_totals(text)
  to authenticated;
