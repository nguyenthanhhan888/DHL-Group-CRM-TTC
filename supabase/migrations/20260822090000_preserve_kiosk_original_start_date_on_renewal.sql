-- A Kiosk start_date is its original activation date, while payment start_date
-- and end_date describe the individual service period purchased by a renewal.
-- Renewal must therefore extend only the Kiosk end_date. Legacy NULL start_date
-- values are deliberately preserved; repairing historical activation data is a
-- separate data-quality decision and must not be inferred from a renewal.

create or replace function public.admin_manual_renew_kiosk(
  kiosk_id_input bigint,
  months_input integer,
  start_date_input date,
  base_amount_input numeric,
  discount_input numeric default 0,
  discount_reason_input text default null,
  payment_method_input text default null,
  note_input text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor public.user_roles%rowtype;
  kiosk_record public.kiosks%rowtype;
  customer_record public.customers%rowtype;
  payment_record public.payments%rowtype;
  confirmation_date date := (pg_catalog.now() at time zone 'Asia/Ho_Chi_Minh')::date;
  confirmation_timestamp timestamptz := pg_catalog.now();
  effective_start_date date;
  calculated_end_date date;
  normalized_discount numeric := coalesce(discount_input, 0);
  actual_amount numeric;
  normalized_method text := lower(trim(coalesce(payment_method_input, '')));
begin
  actor := private.assert_payment_permission();
  if lower(actor.role) <> 'admin' then
    raise exception 'Chỉ Admin được xác nhận gia hạn thủ công.' using errcode = '42501';
  end if;

  if months_input is null or months_input < 1 then
    raise exception 'Số tháng phải là số nguyên lớn hơn 0.' using errcode = '22023';
  end if;
  if base_amount_input is null or base_amount_input < 0 then
    raise exception 'Giá gốc không hợp lệ.' using errcode = '22023';
  end if;
  if normalized_discount < 0 or normalized_discount > base_amount_input then
    raise exception 'Giảm giá phải từ 0 đến giá gốc.' using errcode = '22023';
  end if;
  if normalized_discount > 0 and nullif(trim(discount_reason_input), '') is null then
    raise exception 'Lý do giảm giá là bắt buộc khi có giảm giá.' using errcode = '22023';
  end if;
  if normalized_method not in ('transfer', 'cash', 'other') then
    raise exception 'Phương thức thanh toán không hợp lệ.' using errcode = '22023';
  end if;

  select * into kiosk_record
  from public.kiosks
  where id = kiosk_id_input
  for update;
  if not found then
    raise exception 'Không tìm thấy Kiosk.' using errcode = 'P0002';
  end if;
  if kiosk_record.customer_id is null then
    raise exception 'Kiosk thiếu khách hàng.' using errcode = '22023';
  end if;

  select * into customer_record
  from public.customers
  where id = kiosk_record.customer_id
  for update;
  if not found then
    raise exception 'Khách hàng của Kiosk không tồn tại.' using errcode = 'P0002';
  end if;

  -- start_date_input remains in the public signature for client compatibility,
  -- but the locked Kiosk row and confirmation date are authoritative.
  effective_start_date := case
    when kiosk_record.end_date is not null and kiosk_record.end_date >= confirmation_date
      then kiosk_record.end_date + 1
    else confirmation_date
  end;
  calculated_end_date := (
    effective_start_date
    + pg_catalog.make_interval(months => months_input)
    - interval '1 day'
  )::date;

  actual_amount := base_amount_input - normalized_discount;
  insert into public.payments(
    customer_id, kiosk_id, start_date, end_date, months, price_per_month,
    discount, discount_reason, total_amount, payment_method, payment_status,
    confirmed_by, confirmed_at, note, transaction_type, service_month_delta
  ) values (
    customer_record.id, kiosk_record.id, effective_start_date, calculated_end_date,
    months_input, base_amount_input / months_input, normalized_discount,
    nullif(trim(discount_reason_input), ''), actual_amount, normalized_method, 'pending',
    null, null, nullif(trim(note_input), ''), 'standard', 0
  ) returning * into payment_record;

  perform pg_catalog.set_config('app.payment_workflow_action', 'confirm', true);
  update public.payments
  set payment_status = 'completed',
      confirmed_by = actor.user_id::text,
      confirmed_at = confirmation_timestamp
  where id = payment_record.id
  returning * into payment_record;

  update public.kiosks
  set status = 'active',
      end_date = calculated_end_date
  where id = kiosk_record.id;

  update public.customers
  set status = case when lower(coalesce(status, '')) = 'pending' then 'active' else status end,
      total_kiosks = (select count(*) from public.kiosks k where k.customer_id = customer_record.id)
  where id = customer_record.id;

  perform private.write_payment_audit(
    'admin_manual_renewal',
    jsonb_build_object('kiosk', to_jsonb(kiosk_record)),
    jsonb_build_object(
      'payment', to_jsonb(payment_record),
      'kiosk_id', kiosk_record.id,
      'original_activation_date', kiosk_record.start_date,
      'old_expiry_date', kiosk_record.end_date,
      'requested_start_date', start_date_input,
      'renewal_period_start', effective_start_date,
      'renewal_period_end', calculated_end_date,
      'months', months_input,
      'base_amount', base_amount_input,
      'discount', normalized_discount,
      'actual_amount', actual_amount,
      'payment_source', 'admin_manual'
    ),
    coalesce(nullif(trim(note_input), ''), 'Admin xác nhận đã thanh toán và gia hạn Kiosk'),
    actor
  );

  return jsonb_build_object(
    'payment', to_jsonb(payment_record),
    'kiosk', (select to_jsonb(k) from public.kiosks k where k.id = kiosk_record.id),
    'period', jsonb_build_object('start_date', effective_start_date, 'end_date', calculated_end_date),
    'payment_source', 'admin_manual'
  );
end;
$function$;

revoke all on function public.admin_manual_renew_kiosk(bigint, integer, date, numeric, numeric, text, text, text)
  from public, anon, authenticated;
grant execute on function public.admin_manual_renew_kiosk(bigint, integer, date, numeric, numeric, text, text, text)
  to authenticated;

create or replace function private.confirm_crm_payment_from_payos(
  payment_id_input bigint,
  reason_input text default 'PayOS paid'
)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
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
  select * into payment_record from public.payments where id = payment_id_input for update;
  if not found then raise exception 'Không tìm thấy thanh toán.'; end if;
  if lower(payment_record.payment_status) <> 'pending' then raise exception 'Chỉ thanh toán Pending mới được xác nhận.'; end if;
  if payment_record.transaction_type <> 'standard' then raise exception 'Giao dịch điều chỉnh không dùng xác nhận PayOS.'; end if;
  before_record := payment_record;

  select * into customer_record from public.customers where id = payment_record.customer_id for update;
  if not found then raise exception 'Khách hàng của thanh toán không tồn tại.'; end if;
  select * into kiosk_record from public.kiosks where id = payment_record.kiosk_id for update;
  if not found then raise exception 'Kiosk của thanh toán không tồn tại.'; end if;
  if kiosk_record.customer_id <> customer_record.id then raise exception 'Kiosk không thuộc khách hàng của thanh toán.'; end if;
  select * into package_record from public.business_types where id = kiosk_record.business_type_id and is_active = true;
  if not found then raise exception 'Gói dịch vụ không tồn tại hoặc đã ngừng hoạt động.'; end if;
  if payment_record.months is null or payment_record.months < 1 then raise exception 'Số tháng thanh toán không hợp lệ.'; end if;
  if payment_record.price_per_month is null or payment_record.price_per_month < 0
    or payment_record.discount is null or payment_record.discount < 0
    or payment_record.total_amount is null or payment_record.total_amount <= 0 then
    raise exception 'Giá trị tài chính của thanh toán không hợp lệ.';
  end if;
  expected_total := payment_record.price_per_month * payment_record.months - payment_record.discount;
  if payment_record.total_amount <> expected_total then raise exception 'Tổng tiền không khớp giá, số tháng và giảm giá.'; end if;

  effective_start_date := case
    when kiosk_record.end_date is not null and kiosk_record.end_date >= confirmation_date
      then kiosk_record.end_date + 1
    else confirmation_date
  end;
  calculated_end_date := (
    effective_start_date
    + pg_catalog.make_interval(months => payment_record.months)
    - interval '1 day'
  )::date;

  perform pg_catalog.set_config('app.payment_workflow_action', 'confirm', true);
  update public.payments
  set payment_status = 'completed', confirmed_by = null, confirmed_at = confirmation_timestamp,
      start_date = effective_start_date, end_date = calculated_end_date
  where id = payment_record.id
  returning * into payment_record;

  update public.kiosks
  set status = 'active', end_date = calculated_end_date
  where id = kiosk_record.id;

  update public.customers
  set status = case when lower(coalesce(status, '')) = 'pending' then 'active' else status end,
      total_kiosks = (select count(*) from public.kiosks k where k.customer_id = customer_record.id)
  where id = customer_record.id;

  perform private.write_ttc_audit(
    'Payment', 'confirm_payos', 'payments', payment_record.id::text,
    to_jsonb(before_record), to_jsonb(payment_record), reason_input
  );
  return jsonb_build_object(
    'payment', to_jsonb(payment_record),
    'kiosk', (select to_jsonb(k) from public.kiosks k where k.id = kiosk_record.id),
    'customer', (select to_jsonb(c) from public.customers c where c.id = customer_record.id)
  );
end;
$function$;

-- This deferred trigger remains a consistency backstop for completed service
-- periods. It may reactivate and extend a Kiosk, but it never rewrites the
-- original activation date (including a legacy NULL activation date).
create or replace function private.sync_completed_renewal_kiosk_period()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.registration_batch_id is null
    and new.payment_status = 'completed'
    and new.start_date is not null
    and new.end_date is not null then
    update public.kiosks
    set status = 'active', end_date = new.end_date
    where id = new.kiosk_id;
  end if;
  return null;
end;
$function$;

revoke all on function private.sync_completed_renewal_kiosk_period() from public;
