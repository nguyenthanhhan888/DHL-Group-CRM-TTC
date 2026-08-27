-- Keep cancelled public-checkout Kiosks for history, but do not present them as
-- operational Kiosks waiting for Admin approval.

update public.kiosks k
set status = 'inactive'
where k.status = 'pending'
  and exists (
    select 1
    from public.registration_requests r
    join public.registration_batch_items i
      on i.registration_request_id = r.id and i.kiosk_id = k.id
    join public.registration_batches b on b.id = i.batch_id
    left join public.payments p on p.id = b.payment_id
    where r.status = 'cancelled'
      and r.metadata->>'workflow' = 'public_payos'
      and b.status = 'cancelled'
      and (p.id is null or p.payment_status = 'cancelled')
  )
  and not exists (
    select 1 from public.payments completed_payment
    where completed_payment.kiosk_id = k.id
      and completed_payment.payment_status = 'completed'
  )
  and not exists (
    select 1 from public.registration_requests live_request
    where live_request.kiosk_id = k.id
      and live_request.status in ('awaiting_payment', 'pending', 'approved')
  );

create or replace function private.finalize_cancelled_public_kiosk_from_legacy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.status = 'approved'
    and old.status is distinct from new.status
    and new.metadata->>'request_type' = 'legacy'
    and new.customer_id is not null
    and new.kiosk_id is not null
    and (
      coalesce(new.total_amount, 0) <= 0
      or exists (
        select 1
        from public.payments completed_payment
        where completed_payment.id = new.payment_id
          and completed_payment.customer_id = new.customer_id
          and completed_payment.kiosk_id = new.kiosk_id
          and completed_payment.payment_status = 'completed'
      )
    )
    and exists (
      select 1
      from public.registration_requests cancelled_public
      where cancelled_public.id <> new.id
        and cancelled_public.kiosk_id = new.kiosk_id
        and cancelled_public.status = 'cancelled'
        and cancelled_public.metadata->>'workflow' = 'public_payos'
    )
  then
    update public.kiosks
    set category_id = new.category_id,
        business_type_id = new.business_type_id,
        service_name = new.service_name,
        start_date = new.requested_start_date,
        end_date = new.requested_end_date,
        status = case
          when new.requested_end_date < (pg_catalog.now() at time zone 'Asia/Ho_Chi_Minh')::date
            then 'expired'
          else 'active'
        end
    where id = new.kiosk_id
      and customer_id = new.customer_id
      and status in ('pending', 'inactive');
  end if;
  return new;
end;
$function$;

revoke all on function private.finalize_cancelled_public_kiosk_from_legacy()
  from public, anon, authenticated, service_role;

create or replace function public.admin_cancel_awaiting_registration(
  request_id_input bigint,
  reason_input text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  request_record public.registration_requests%rowtype;
  batch_record public.registration_batches%rowtype;
  payment_record public.payments%rowtype;
  cancelled_at timestamptz := pg_catalog.now();
  affected_requests bigint[];
begin
  if auth.uid() is null or not exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid()
      and pg_catalog.lower(ur.role) = 'admin'
      and ur.is_active
  ) then
    raise exception 'Bạn không có quyền hủy hồ sơ chờ thanh toán.' using errcode = '42501';
  end if;
  if nullif(pg_catalog.btrim(reason_input), '') is null then
    raise exception 'Cần nhập lý do hủy.' using errcode = '22023';
  end if;

  select * into request_record
  from public.registration_requests
  where id = request_id_input
  for update;
  if not found then
    raise exception 'Không tìm thấy hồ sơ đăng ký.' using errcode = 'P0002';
  end if;
  if request_record.status = 'cancelled' then
    return pg_catalog.jsonb_build_object('already_cancelled', true, 'request_id', request_record.id);
  end if;
  if request_record.status <> 'awaiting_payment' then
    raise exception 'Chỉ hồ sơ chờ thanh toán mới có thể hủy.' using errcode = '22023';
  end if;

  if request_record.registration_batch_id is not null then
    select * into batch_record
    from public.registration_batches
    where id = request_record.registration_batch_id
    for update;
    select * into payment_record
    from public.payments
    where id = batch_record.payment_id
    for update;

    if payment_record.payment_status = 'completed'
      or exists (
        select 1 from public.payos_orders o
        where o.payment_id = payment_record.id and o.status = 'paid'
      )
      or exists (
        select 1
        from public.registration_batch_items i
        join public.kiosks k on k.id = i.kiosk_id
        where i.batch_id = batch_record.id and k.status = 'active'
      ) then
      raise exception 'Hồ sơ đã có thanh toán hoàn tất hoặc Kiosk hoạt động.' using errcode = '23505';
    end if;

    select pg_catalog.array_agg(i.registration_request_id order by i.registration_request_id)
    into affected_requests
    from public.registration_batch_items i
    where i.batch_id = batch_record.id;

    update public.payos_orders
    set status = 'cancelled', active_slot = false,
        processed_at = coalesce(processed_at, cancelled_at), updated_at = cancelled_at,
        provider_payload = coalesce(provider_payload, '{}'::jsonb)
          || pg_catalog.jsonb_build_object('admin_logical_cancel', true)
    where payment_id = payment_record.id and status = 'pending';

    if payment_record.payment_status = 'pending' then
      perform pg_catalog.set_config('app.payment_workflow_action', 'cancel', true);
      update public.payments
      set payment_status = 'cancelled',
          note = pg_catalog.concat_ws(E'\n', nullif(note, ''), 'Admin cancelled: ' || pg_catalog.btrim(reason_input))
      where id = payment_record.id;
    end if;
    update public.registration_batches
    set status = 'cancelled', updated_at = cancelled_at
    where id = batch_record.id;

    update public.kiosks k
    set status = 'inactive'
    where k.status = 'pending'
      and exists (
        select 1 from public.registration_batch_items i
        where i.batch_id = batch_record.id and i.kiosk_id = k.id
      )
      and not exists (
        select 1 from public.payments completed_payment
        where completed_payment.kiosk_id = k.id
          and completed_payment.payment_status = 'completed'
      );
  else
    affected_requests := array[request_record.id];
  end if;

  update public.registration_requests
  set status = 'cancelled',
      reviewed_at = cancelled_at,
      reviewed_by = auth.uid(),
      rejection_reason = pg_catalog.btrim(reason_input),
      metadata = coalesce(metadata, '{}'::jsonb) || pg_catalog.jsonb_build_object(
        'cancelled_source', 'admin', 'cancelled_at', cancelled_at
      )
  where id = any(affected_requests);

  perform private.write_ttc_audit(
    'Registration', 'admin_cancel', 'registration_requests', request_id_input::text,
    pg_catalog.to_jsonb(request_record),
    pg_catalog.jsonb_build_object(
      'status', 'cancelled',
      'batch_id', request_record.registration_batch_id,
      'affected_request_ids', affected_requests
    ),
    pg_catalog.btrim(reason_input)
  );

  return pg_catalog.jsonb_build_object(
    'already_cancelled', false,
    'request_id', request_id_input,
    'batch_id', request_record.registration_batch_id,
    'affected_request_ids', affected_requests
  );
end;
$function$;

revoke all on function public.admin_cancel_awaiting_registration(bigint, text)
  from public, anon, authenticated;
grant execute on function public.admin_cancel_awaiting_registration(bigint, text)
  to authenticated;
