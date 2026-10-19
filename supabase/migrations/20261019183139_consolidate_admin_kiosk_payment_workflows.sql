-- Keep manual CRM confirmation on the same inclusive service-period invariant
-- already used by signed PayOS confirmation. This migration intentionally
-- updates function definitions only; it does not rewrite historical rows.

-- Production has both bigint and (bigint,text) overloads while the latter also
-- has a default. Recreate the two-argument overload without that redundant
-- default so one-argument calls resolve deterministically to the compatibility
-- wrapper. DROP RESTRICT intentionally aborts if an unknown DB dependency exists.
drop function public.confirm_payment(bigint, text) restrict;

create function public.confirm_payment(
  payment_id_input bigint,
  reason_input text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor public.user_roles%rowtype;
  payment_record public.payments%rowtype;
  before_record public.payments%rowtype;
  customer_record public.customers%rowtype;
  kiosk_record public.kiosks%rowtype;
  package_record public.business_types%rowtype;
  confirmation_timestamp timestamptz := pg_catalog.now();
  confirmation_date date := (pg_catalog.now() at time zone 'Asia/Ho_Chi_Minh')::date;
  effective_start_date date;
  calculated_end_date date;
  expected_total numeric;
begin
  actor := private.assert_payment_permission();

  select * into payment_record
  from public.payments
  where id = payment_id_input
  for update;

  if not found then
    raise exception 'Không tìm thấy thanh toán.' using errcode = 'P0002';
  end if;
  if pg_catalog.lower(payment_record.payment_status) <> 'pending' then
    raise exception 'Chỉ thanh toán Pending mới được xác nhận.' using errcode = '22023';
  end if;
  if payment_record.transaction_type <> 'standard' then
    raise exception 'Giao dịch điều chỉnh không dùng confirm_payment().' using errcode = '22023';
  end if;

  before_record := payment_record;

  select * into customer_record
  from public.customers
  where id = payment_record.customer_id
  for update;
  if not found then
    raise exception 'Khách hàng của thanh toán không tồn tại.' using errcode = '23503';
  end if;

  select * into kiosk_record
  from public.kiosks
  where id = payment_record.kiosk_id
  for update;
  if not found then
    raise exception 'Kiosk của thanh toán không tồn tại.' using errcode = '23503';
  end if;
  if kiosk_record.customer_id <> customer_record.id then
    raise exception 'Kiosk không thuộc khách hàng của thanh toán.' using errcode = '23514';
  end if;

  select * into package_record
  from public.business_types
  where id = kiosk_record.business_type_id and is_active = true;
  if not found then
    raise exception 'Gói dịch vụ không tồn tại hoặc đã ngừng hoạt động.' using errcode = '22023';
  end if;

  if payment_record.months is null or payment_record.months < 1
    or payment_record.bonus_months is null or payment_record.bonus_months < 0 then
    raise exception 'Số tháng thanh toán không hợp lệ.' using errcode = '22023';
  end if;
  if payment_record.price_per_month is null or payment_record.price_per_month < 0
    or payment_record.discount is null or payment_record.discount < 0
    or payment_record.total_amount is null or payment_record.total_amount <= 0 then
    raise exception 'Giá trị tài chính của thanh toán không hợp lệ.' using errcode = '22023';
  end if;

  expected_total := payment_record.price_per_month * payment_record.months
    - payment_record.discount;
  if payment_record.total_amount <> expected_total then
    raise exception 'Tổng tiền không khớp giá, số tháng và giảm giá.' using errcode = '23514';
  end if;

  effective_start_date := case
    when kiosk_record.end_date is not null and kiosk_record.end_date >= confirmation_date
      then kiosk_record.end_date + 1
    else confirmation_date
  end;
  calculated_end_date := (
    effective_start_date
    + pg_catalog.make_interval(months => payment_record.months + payment_record.bonus_months)
    - interval '1 day'
  )::date;

  perform pg_catalog.set_config('app.payment_workflow_action', 'confirm', true);
  update public.payments
  set payment_status = 'completed',
      confirmed_by = actor.user_id,
      confirmed_at = confirmation_timestamp,
      start_date = effective_start_date,
      end_date = calculated_end_date
  where id = payment_record.id
  returning * into payment_record;

  update public.kiosks
  set status = 'active',
      start_date = coalesce(start_date, effective_start_date),
      end_date = calculated_end_date
  where id = kiosk_record.id;

  update public.customers
  set status = case
        when pg_catalog.lower(coalesce(status, '')) = 'pending' then 'active'
        else status
      end,
      total_kiosks = (
        select pg_catalog.count(*) from public.kiosks k where k.customer_id = customer_record.id
      )
  where id = customer_record.id;

  perform private.write_payment_audit(
    'confirm',
    pg_catalog.to_jsonb(before_record),
    pg_catalog.to_jsonb(payment_record),
    reason_input,
    actor
  );

  return pg_catalog.jsonb_build_object(
    'payment', pg_catalog.to_jsonb(payment_record),
    'kiosk', (select pg_catalog.to_jsonb(k) from public.kiosks k where k.id = kiosk_record.id),
    'customer', (select pg_catalog.to_jsonb(c) from public.customers c where c.id = customer_record.id)
  );
end;
$function$;

-- Preserve the legacy one-argument contract, but route it through the corrected
-- implementation instead of the obsolete private.complete_payment helper.
create or replace function public.confirm_payment(payment_id_input bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if private.current_user_role() is distinct from 'admin' then
    raise exception 'Chỉ admin được xác nhận thanh toán trực tiếp.' using errcode = '42501';
  end if;
  perform public.confirm_payment(payment_id_input, 'Xác nhận thanh toán');
end;
$function$;

revoke all on function public.confirm_payment(bigint, text) from public, anon;
revoke all on function public.confirm_payment(bigint) from public, anon;
grant execute on function public.confirm_payment(bigint, text) to authenticated;
grant execute on function public.confirm_payment(bigint) to authenticated;

-- Create a Kiosk for an existing Customer and choose the payment outcome in one
-- database transaction. PayOS provider checkout creation remains a separate API
-- call after this RPC; this function only owns the durable pending intent.
create or replace function public.admin_create_existing_customer_kiosk(
  customer_id_input bigint,
  kiosk_input jsonb,
  payment_mode_input text,
  idempotency_key_input text,
  external_payment_note_input text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  mode_value text := pg_catalog.lower(pg_catalog.btrim(coalesce(payment_mode_input, '')));
  idempotency_key_value text := pg_catalog.btrim(coalesce(idempotency_key_input, ''));
  external_note_value text := nullif(pg_catalog.btrim(external_payment_note_input), '');
  actor_id uuid := auth.uid();
  created jsonb;
  confirmation jsonb;
  request_record public.registration_requests%rowtype;
  payment_record public.payments%rowtype;
  kiosk_record public.kiosks%rowtype;
  customer_record public.customers%rowtype;
  stored_mode text;
  requested_identity text := nullif(pg_catalog.btrim(kiosk_input->>'facebook_id'), '');
begin
  if not (public.has_user_permission('customers') or public.has_user_permission('customer-detail'))
    or not (public.has_user_permission('kiosks') or public.has_user_permission('kiosk-detail')) then
    raise exception 'Cần quyền Khách hàng và Kiosk để đăng ký thêm Kiosk.' using errcode = '42501';
  end if;
  if not public.has_user_permission('payments') then
    raise exception 'Cần quyền Thanh toán để chọn hình thức thanh toán.' using errcode = '42501';
  end if;
  if mode_value not in ('payos', 'external_paid') then
    raise exception 'Hình thức thanh toán không hợp lệ.' using errcode = '22023';
  end if;
  if pg_catalog.length(idempotency_key_value) < 8 or pg_catalog.length(idempotency_key_value) > 120 then
    raise exception 'Khóa chống trùng không hợp lệ.' using errcode = '22023';
  end if;
  if mode_value = 'external_paid' and external_note_value is null then
    raise exception 'Cần ghi chú đối soát khoản tiền đã nhận.' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'admin-existing-kiosk:' || actor_id::text || ':' || idempotency_key_value,
      0
    )
  );

  select * into request_record
  from public.registration_requests r
  where r.metadata->>'admin_kiosk_idempotency_key' = idempotency_key_value
    and r.metadata->>'admin_kiosk_actor_id' = actor_id::text
  order by r.id desc
  limit 1
  for update;

  if found then
    stored_mode := request_record.metadata->>'admin_kiosk_payment_mode';
    select * into payment_record from public.payments where id = request_record.payment_id for update;
    select * into kiosk_record from public.kiosks where id = request_record.kiosk_id for update;
    select * into customer_record from public.customers where id = request_record.customer_id for update;
    if payment_record.id is null or kiosk_record.id is null or customer_record.id is null then
      raise exception 'Dữ liệu của yêu cầu chống trùng không toàn vẹn.' using errcode = '23514';
    end if;
    if stored_mode is distinct from mode_value
      or customer_record.id is distinct from customer_id_input
      or kiosk_record.facebook_id is distinct from requested_identity then
      raise exception 'Khóa chống trùng đã được dùng cho yêu cầu khác.' using errcode = '23505';
    end if;
    return pg_catalog.jsonb_build_object(
      'reused', true,
      'payment_mode', stored_mode,
      'customer', pg_catalog.to_jsonb(customer_record),
      'kiosk', pg_catalog.to_jsonb(kiosk_record),
      'request', pg_catalog.to_jsonb(request_record),
      'payment', pg_catalog.to_jsonb(payment_record)
    );
  end if;

  created := public.submit_existing_customer_kiosk(customer_id_input, kiosk_input);
  select * into request_record
  from public.registration_requests
  where id = (created->'request'->>'id')::bigint
  for update;
  select * into payment_record
  from public.payments
  where id = (created->'payment'->>'id')::bigint
  for update;
  select * into kiosk_record
  from public.kiosks
  where id = (created->'kiosk'->>'id')::bigint
  for update;

  update public.registration_requests
  set metadata = coalesce(metadata, '{}'::jsonb) || pg_catalog.jsonb_build_object(
        'workflow', 'admin_existing_customer',
        'admin_kiosk_payment_mode', mode_value,
        'admin_kiosk_idempotency_key', idempotency_key_value,
        'admin_kiosk_actor_id', actor_id::text
      )
  where id = request_record.id
  returning * into request_record;

  if mode_value = 'external_paid' then
    perform pg_catalog.set_config('app.payment_workflow_action', 'edit', true);
    update public.payments
    set payment_method = 'external',
        note = pg_catalog.concat_ws(E'\n', nullif(note, ''),
          'Admin external payment: ' || external_note_value)
    where id = payment_record.id;

    confirmation := public.confirm_payment(payment_record.id, external_note_value);
    payment_record := pg_catalog.jsonb_populate_record(payment_record, confirmation->'payment');
    kiosk_record := pg_catalog.jsonb_populate_record(kiosk_record, confirmation->'kiosk');

    update public.registration_requests
    set status = 'approved',
        requested_start_date = payment_record.start_date,
        requested_end_date = payment_record.end_date,
        reviewed_at = payment_record.confirmed_at,
        reviewed_by = actor_id,
        metadata = metadata || pg_catalog.jsonb_build_object(
          'completed_source', 'admin_external',
          'completed_at', payment_record.confirmed_at
        )
    where id = request_record.id
    returning * into request_record;
  end if;

  select * into customer_record
  from public.customers
  where id = customer_id_input;

  perform private.write_ttc_audit(
    'Kiosk',
    case when mode_value = 'external_paid' then 'create_external_paid' else 'create_payos_pending' end,
    'kiosks',
    kiosk_record.id::text,
    null,
    pg_catalog.jsonb_build_object(
      'customer_id', customer_record.id,
      'kiosk_id', kiosk_record.id,
      'registration_request_id', request_record.id,
      'payment_id', payment_record.id,
      'payment_mode', mode_value,
      'payment_status', payment_record.payment_status,
      'amount', payment_record.total_amount,
      'idempotency_key', idempotency_key_value
    ),
    case when mode_value = 'external_paid'
      then external_note_value
      else 'Admin tạo Kiosk chờ thanh toán PayOS'
    end
  );

  return pg_catalog.jsonb_build_object(
    'reused', false,
    'payment_mode', mode_value,
    'customer', pg_catalog.to_jsonb(customer_record),
    'kiosk', pg_catalog.to_jsonb(kiosk_record),
    'request', pg_catalog.to_jsonb(request_record),
    'payment', pg_catalog.to_jsonb(payment_record)
  );
end;
$function$;

revoke all on function public.admin_create_existing_customer_kiosk(bigint, jsonb, text, text, text)
  from public, anon;
grant execute on function public.admin_create_existing_customer_kiosk(bigint, jsonb, text, text, text)
  to authenticated;
