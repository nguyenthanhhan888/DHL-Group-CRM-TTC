-- Keep CRM revenue consistent everywhere by using completed payments as the
-- canonical revenue ledger.
--
-- Fixes cases where legacy/manual kiosk registration populated
-- customers.total_paid / kiosks.total_paid but did not create a completed
-- payment row, so dashboard/report revenue stayed unchanged.

create or replace function private.recalculate_customer_payment_total(customer_id_input bigint)
returns void
language sql
security definer
set search_path = ''
as $function$
  update public.customers c
  set
    total_paid = coalesce((
      select sum(p.total_amount)
      from public.payments p
      where p.customer_id = customer_id_input
        and lower(coalesce(p.payment_status, '')) = 'completed'
        and p.confirmed_at is not null
    ), 0),
    last_payment_date = (
      select max((p.confirmed_at at time zone 'Asia/Ho_Chi_Minh')::date)
      from public.payments p
      where p.customer_id = customer_id_input
        and lower(coalesce(p.payment_status, '')) = 'completed'
        and p.confirmed_at is not null
    ),
    updated_at = pg_catalog.now()
  where c.id = customer_id_input;
$function$;

create or replace function private.recalculate_kiosk_payment_total(kiosk_id_input bigint)
returns void
language sql
security definer
set search_path = ''
as $function$
  update public.kiosks k
  set
    total_paid = coalesce((
      select sum(p.total_amount)
      from public.payments p
      where p.kiosk_id = kiosk_id_input
        and lower(coalesce(p.payment_status, '')) = 'completed'
        and p.confirmed_at is not null
    ), 0),
    kiosk_total_paid = coalesce((
      select sum(p.total_amount)
      from public.payments p
      where p.kiosk_id = kiosk_id_input
        and lower(coalesce(p.payment_status, '')) = 'completed'
        and p.confirmed_at is not null
    ), 0),
    last_payment_date = (
      select max((p.confirmed_at at time zone 'Asia/Ho_Chi_Minh')::date)
      from public.payments p
      where p.kiosk_id = kiosk_id_input
        and lower(coalesce(p.payment_status, '')) = 'completed'
        and p.confirmed_at is not null
    )
  where k.id = kiosk_id_input;
$function$;

create or replace function private.sync_completed_payment_totals()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    if old.customer_id is not null then
      perform private.recalculate_customer_payment_total(old.customer_id);
    end if;
    if old.kiosk_id is not null then
      perform private.recalculate_kiosk_payment_total(old.kiosk_id);
    end if;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    if new.customer_id is not null then
      perform private.recalculate_customer_payment_total(new.customer_id);
    end if;
    if new.kiosk_id is not null then
      perform private.recalculate_kiosk_payment_total(new.kiosk_id);
    end if;
    return new;
  end if;

  return old;
end;
$function$;

drop trigger if exists sync_customer_payment_totals_trigger on public.payments;
drop trigger if exists sync_completed_payment_totals_trigger on public.payments;
create trigger sync_completed_payment_totals_trigger
after insert or update or delete on public.payments
for each row
execute function private.sync_completed_payment_totals();

create or replace function public.review_public_legacy_registration_request(
  request_id_input bigint,
  action_input text,
  reason_input text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor public.user_roles%rowtype;
  request_record public.registration_requests%rowtype;
  customer_record public.customers%rowtype;
  kiosk_record public.kiosks%rowtype;
  payment_record public.payments%rowtype;
  customer_payload jsonb;
  request_code_value text;
  customer_facebook_id_value text;
  customer_phone_value text;
  customer_name_value text;
  customer_link_value text;
  next_status text;
  amount_value numeric;
  confirmed_timestamp timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Bạn phải đăng nhập để xử lý yêu cầu.' using errcode = '42501';
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
          and 'registration-requests' = any(rp.permissions)
      )
    );
  if not found then
    raise exception 'Không có quyền xử lý yêu cầu bổ sung.' using errcode = '42501';
  end if;

  select *
  into request_record
  from public.registration_requests r
  where r.id = request_id_input
  for update;
  if not found then
    raise exception 'Không tìm thấy yêu cầu bổ sung.';
  end if;
  if request_record.metadata->>'request_type' <> 'legacy' then
    raise exception 'Yêu cầu này không thuộc luồng bổ sung khách hàng cũ.' using errcode = '22023';
  end if;

  if lower(trim(action_input)) = 'approve' then
    next_status := 'approved';
    if request_record.status = 'approved'
      and request_record.customer_id is not null
      and request_record.kiosk_id is not null
      and (
        request_record.payment_id is not null
        or coalesce(request_record.total_amount, 0) <= 0
      ) then
      return jsonb_build_object(
        'request', to_jsonb(request_record),
        'customer_id', request_record.customer_id,
        'kiosk_id', request_record.kiosk_id,
        'payment_id', request_record.payment_id,
        'already_processed', true
      );
    end if;
    if request_record.status not in ('pending', 'approved') then
      raise exception 'Yêu cầu đã bị từ chối và không thể duyệt.';
    end if;
  elsif lower(trim(action_input)) = 'cancel' then
    if request_record.status <> 'pending' then
      raise exception 'Chỉ yêu cầu đang chờ mới có thể được hủy.';
    end if;
    if nullif(trim(reason_input), '') is null then
      raise exception 'Lý do hủy là bắt buộc.' using errcode = '22023';
    end if;
    next_status := 'rejected';
  else
    raise exception 'Thao tác xử lý không hợp lệ.' using errcode = '22023';
  end if;

  if next_status = 'approved' then
    customer_payload := coalesce(request_record.metadata->'customer', '{}'::jsonb);
    request_code_value := nullif(request_record.metadata->>'request_code', '');
    customer_facebook_id_value := nullif(
      regexp_replace(coalesce(customer_payload->>'facebook_id', ''), '[^0-9]', '', 'g'),
      ''
    );
    customer_phone_value := nullif(trim(coalesce(customer_payload->>'phone', request_record.phone)), '');
    customer_name_value := nullif(trim(coalesce(customer_payload->>'facebook_name', request_record.facebook_name)), '');
    customer_link_value := nullif(trim(customer_payload->>'facebook_link'), '');
    amount_value := greatest(coalesce(request_record.total_amount, 0), 0);

    if customer_name_value is null or customer_phone_value is null then
      raise exception 'Hồ sơ thiếu tên hoặc số điện thoại khách hàng.' using errcode = '22023';
    end if;
    if request_record.category_id is null
      or request_record.business_type_id is null
      or request_record.requested_start_date is null
      or request_record.requested_end_date is null then
      raise exception 'Hồ sơ thiếu dữ liệu bắt buộc để tạo kiosk.' using errcode = '22023';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('legacy-approval:' || coalesce(request_code_value, request_record.id::text), 0)
    );

    if request_record.customer_id is not null then
      select * into customer_record
      from public.customers c
      where c.id = request_record.customer_id
      for update;
    end if;

    if customer_record.id is null and request_code_value is not null then
      select c.*
      into customer_record
      from public.registration_requests sibling
      join public.customers c on c.id = sibling.customer_id
      where sibling.metadata->>'request_type' = 'legacy'
        and sibling.metadata->>'request_code' = request_code_value
      order by sibling.id
      limit 1
      for update of c;
    end if;

    if customer_record.id is null then
      select *
      into customer_record
      from public.customers c
      where (customer_facebook_id_value is not null and c.facebook_id = customer_facebook_id_value)
         or c.phone = customer_phone_value
      order by
        case when customer_facebook_id_value is not null
          and c.facebook_id = customer_facebook_id_value then 0 else 1 end,
        c.id
      limit 1
      for update;
    end if;

    if customer_record.id is null then
      insert into public.customers(
        facebook_name, facebook_id, facebook_link, phone, status,
        total_paid, last_payment_date, note
      )
      values(
        customer_name_value,
        customer_facebook_id_value,
        customer_link_value,
        customer_phone_value,
        'active',
        0,
        null,
        'Bổ sung từ hồ sơ khách hàng cũ #' || request_record.id
      )
      returning * into customer_record;
    else
      update public.customers
      set
        facebook_name = coalesce(nullif(trim(facebook_name), ''), customer_name_value),
        facebook_id = coalesce(facebook_id, customer_facebook_id_value),
        facebook_link = coalesce(facebook_link, customer_link_value),
        phone = coalesce(phone, customer_phone_value),
        status = case when status = 'inactive' then status else 'active' end,
        updated_at = pg_catalog.now()
      where id = customer_record.id
      returning * into customer_record;
    end if;

    if request_record.kiosk_id is not null then
      select * into kiosk_record
      from public.kiosks k
      where k.id = request_record.kiosk_id
      for update;
    end if;

    if kiosk_record.id is null and request_record.facebook_id is not null then
      select * into kiosk_record
      from public.kiosks k
      where k.facebook_id = request_record.facebook_id
      for update;
    end if;

    if kiosk_record.id is null then
      insert into public.kiosks(
        customer_id, facebook_name, facebook_id, facebook_link,
        category_id, business_type_id, service_name,
        start_date, end_date, status, auto_approve,
        total_paid, kiosk_total_paid, last_payment_date, note, is_primary
      )
      values(
        customer_record.id,
        request_record.facebook_name,
        request_record.facebook_id,
        request_record.facebook_link,
        request_record.category_id,
        request_record.business_type_id,
        request_record.service_name,
        request_record.requested_start_date,
        request_record.requested_end_date,
        case
          when request_record.requested_end_date < current_date then 'expired'
          else 'active'
        end,
        false,
        0,
        0,
        null,
        request_record.note,
        not exists (
          select 1 from public.kiosks existing
          where existing.customer_id = customer_record.id and existing.is_primary
        )
      )
      returning * into kiosk_record;
    elsif kiosk_record.customer_id <> customer_record.id then
      raise exception 'Facebook ID kiosk đã thuộc về một khách hàng khác.' using errcode = '23505';
    end if;

    if amount_value > 0 and request_record.payment_id is null then
      confirmed_timestamp := (
        request_record.requested_start_date::timestamp at time zone 'Asia/Ho_Chi_Minh'
      );
      perform set_config('app.payment_workflow_action', 'adjustment', true);

      insert into public.payments(
        customer_id, kiosk_id, start_date, end_date, months,
        price_per_month, discount, discount_reason, total_amount,
        payment_method, payment_status, transaction_type, confirmed_at, note
      )
      values(
        customer_record.id,
        kiosk_record.id,
        request_record.requested_start_date,
        request_record.requested_end_date,
        greatest(coalesce(request_record.months, 1), 1),
        amount_value,
        0,
        null,
        amount_value,
        coalesce(nullif(request_record.payment_method, ''), 'legacy'),
        'completed',
        'standard',
        confirmed_timestamp,
        concat_ws(' - ', 'Doanh thu bổ sung dữ liệu cũ', nullif(trim(request_record.note), ''))
      )
      returning * into payment_record;
    end if;

    update public.registration_requests
    set
      status = 'approved',
      reviewed_at = pg_catalog.now(),
      reviewed_by = actor.user_id,
      rejection_reason = null,
      customer_id = customer_record.id,
      kiosk_id = kiosk_record.id,
      payment_id = coalesce(payment_record.id, payment_id),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'legacy_review_action', 'approve',
        'legacy_reviewed_by', actor.user_id,
        'legacy_reviewed_at', pg_catalog.now(),
        'materialized_at', pg_catalog.now(),
        'revenue_source', 'payments'
      )
    where id = request_record.id
    returning * into request_record;
  else
    update public.registration_requests
    set
      status = next_status,
      reviewed_at = pg_catalog.now(),
      reviewed_by = actor.user_id,
      rejection_reason = trim(reason_input),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'legacy_review_action', 'cancel',
        'legacy_reviewed_by', actor.user_id,
        'legacy_reviewed_at', pg_catalog.now()
      )
    where id = request_record.id
    returning * into request_record;
  end if;

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
    'review_legacy_' || lower(trim(action_input)),
    jsonb_build_object('status', case when next_status = 'approved' then 'pending_or_incomplete' else 'pending' end),
    jsonb_build_object(
      'status', request_record.status,
      'customer_id', request_record.customer_id,
      'kiosk_id', request_record.kiosk_id,
      'payment_id', request_record.payment_id
    ),
    nullif(trim(reason_input), '')
  );

  return jsonb_build_object(
    'request', to_jsonb(request_record),
    'customer_id', request_record.customer_id,
    'kiosk_id', request_record.kiosk_id,
    'payment_id', request_record.payment_id,
    'already_processed', false
  );
end;
$function$;

revoke all on function public.review_public_legacy_registration_request(bigint, text, text)
  from public, anon, authenticated;
grant execute on function public.review_public_legacy_registration_request(bigint, text, text)
  to authenticated;

do $backfill$
declare
  kiosk_record record;
  completed_total numeric;
  delta_amount numeric;
  revenue_date date;
begin
  for kiosk_record in
    select
      k.id,
      k.customer_id,
      k.start_date,
      k.end_date,
      k.total_paid,
      k.last_payment_date,
      k.note
    from public.kiosks k
    where k.customer_id is not null
      and coalesce(k.total_paid, 0) > 0
  loop
    select coalesce(sum(p.total_amount), 0)
    into completed_total
    from public.payments p
    where p.kiosk_id = kiosk_record.id
      and lower(coalesce(p.payment_status, '')) = 'completed'
      and p.confirmed_at is not null;

    delta_amount := coalesce(kiosk_record.total_paid, 0) - coalesce(completed_total, 0);

    if delta_amount > 0 then
      revenue_date := coalesce(
        kiosk_record.last_payment_date,
        kiosk_record.start_date,
        (now() at time zone 'Asia/Ho_Chi_Minh')::date
      );

      perform set_config('app.payment_workflow_action', 'adjustment', true);
      insert into public.payments(
        customer_id, kiosk_id, start_date, end_date, months,
        price_per_month, discount, discount_reason, total_amount,
        payment_method, payment_status, transaction_type, confirmed_at, note
      )
      values(
        kiosk_record.customer_id,
        kiosk_record.id,
        coalesce(kiosk_record.start_date, revenue_date),
        coalesce(kiosk_record.end_date, kiosk_record.start_date, revenue_date),
        1,
        delta_amount,
        0,
        null,
        delta_amount,
        'legacy',
        'completed',
        'standard',
        revenue_date::timestamp at time zone 'Asia/Ho_Chi_Minh',
        'Đồng bộ doanh thu từ Tổng đã thanh toán kiosk #' || kiosk_record.id
      );
    end if;
  end loop;

  update public.kiosks k
  set
    total_paid = coalesce(payment_totals.total_amount, 0),
    kiosk_total_paid = coalesce(payment_totals.total_amount, 0),
    last_payment_date = payment_totals.last_payment_date
  from (
    select
      k_inner.id,
      coalesce(sum(p.total_amount), 0) as total_amount,
      max((p.confirmed_at at time zone 'Asia/Ho_Chi_Minh')::date) as last_payment_date
    from public.kiosks k_inner
    left join public.payments p
      on p.kiosk_id = k_inner.id
      and lower(coalesce(p.payment_status, '')) = 'completed'
      and p.confirmed_at is not null
    group by k_inner.id
  ) payment_totals
  where k.id = payment_totals.id
    and k.customer_id is not null;

  update public.customers c
  set
    total_paid = coalesce(payment_totals.total_amount, 0),
    last_payment_date = payment_totals.last_payment_date,
    updated_at = pg_catalog.now()
  from (
    select
      c_inner.id,
      coalesce(sum(p.total_amount), 0) as total_amount,
      max((p.confirmed_at at time zone 'Asia/Ho_Chi_Minh')::date) as last_payment_date
    from public.customers c_inner
    left join public.payments p
      on p.customer_id = c_inner.id
      and lower(coalesce(p.payment_status, '')) = 'completed'
      and p.confirmed_at is not null
    group by c_inner.id
  ) payment_totals
  where c.id = payment_totals.id;
end;
$backfill$;

revoke all on function private.recalculate_customer_payment_total(bigint) from public;
revoke all on function private.recalculate_kiosk_payment_total(bigint) from public;
revoke all on function private.sync_completed_payment_totals() from public;
