-- Atomic, admin-only manual Kiosk renewal. Public/PayOS confirmation functions
-- remain unchanged.

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
  today_date date := (pg_catalog.now() at time zone 'Asia/Ho_Chi_Minh')::date;
  confirmation_timestamp timestamptz := pg_catalog.now();
  default_start_date date;
  effective_start_date date;
  calculated_end_date date;
  normalized_discount numeric := coalesce(discount_input, 0);
  actual_amount numeric;
  normalized_method text := lower(trim(coalesce(payment_method_input, '')));
  stored_method text;
begin
  actor := private.assert_payment_permission();
  if lower(actor.role) <> 'admin' then
    raise exception 'Chỉ Admin được xác nhận gia hạn thủ công.' using errcode = '42501';
  end if;

  if months_input is null or months_input < 1 then
    raise exception 'Số tháng phải là số nguyên lớn hơn 0.' using errcode = '22023';
  end if;
  if start_date_input is null then
    raise exception 'Kỳ bắt đầu là bắt buộc.' using errcode = '22023';
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

  default_start_date := case
    when kiosk_record.end_date is not null and kiosk_record.end_date >= today_date
      then kiosk_record.end_date + 1
    else today_date
  end;
  effective_start_date := start_date_input;
  if kiosk_record.end_date is not null
    and kiosk_record.end_date >= today_date
    and effective_start_date <= kiosk_record.end_date then
    raise exception 'Kỳ mới phải bắt đầu sau ngày hết hạn hiện tại để không mất thời gian còn lại.'
      using errcode = '22023';
  end if;

  calculated_end_date := (
    effective_start_date + pg_catalog.make_interval(months => months_input) - interval '1 day'
  )::date;
  if calculated_end_date <= effective_start_date then
    raise exception 'Kỳ kết thúc phải sau kỳ bắt đầu.' using errcode = '22023';
  end if;

  actual_amount := base_amount_input - normalized_discount;
  -- Keep the established payment-method vocabulary compatible with filters,
  -- summaries, reports and exports. Manual origin is recorded in the audit
  -- payload below, while confirmed_by/confirmed_at identify the admin action.
  stored_method := normalized_method;

  insert into public.payments(
    customer_id, kiosk_id, start_date, end_date, months, price_per_month,
    discount, discount_reason, total_amount, payment_method, payment_status,
    confirmed_by, confirmed_at, note, transaction_type, service_month_delta
  ) values (
    customer_record.id, kiosk_record.id, effective_start_date, calculated_end_date,
    months_input, base_amount_input / months_input, normalized_discount,
    nullif(trim(discount_reason_input), ''), actual_amount, stored_method, 'pending',
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
      start_date = effective_start_date,
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
      'old_expiry_date', kiosk_record.end_date,
      'default_start_date', default_start_date,
      'new_start_date', effective_start_date,
      'new_expiry_date', calculated_end_date,
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

