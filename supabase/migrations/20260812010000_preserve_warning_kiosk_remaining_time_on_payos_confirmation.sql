-- Preserve remaining service time for both active and warning Kiosks when a
-- PayOS payment is confirmed. All other validation and update behavior is
-- intentionally unchanged from the existing confirmation function.

create or replace function private.confirm_crm_payment_from_payos(
  payment_id_input bigint,
  reason_input text default 'PayOS paid'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  payment_record public.payments%rowtype;
  before_record public.payments%rowtype;
  customer_record public.customers%rowtype;
  kiosk_record public.kiosks%rowtype;
  package_record public.business_types%rowtype;
  confirmation_timestamp timestamptz := now();
  confirmation_date date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
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

  select * into package_record from public.business_types
  where id = kiosk_record.business_type_id and is_active = true;
  if not found then raise exception 'Gói dịch vụ không tồn tại hoặc đã ngừng hoạt động.'; end if;
  if payment_record.months is null or payment_record.months < 1 then raise exception 'Số tháng thanh toán không hợp lệ.'; end if;
  if payment_record.price_per_month is null or payment_record.price_per_month < 0
    or payment_record.discount is null or payment_record.discount < 0
    or payment_record.total_amount is null or payment_record.total_amount <= 0 then
    raise exception 'Giá trị tài chính của thanh toán không hợp lệ.';
  end if;
  expected_total := payment_record.price_per_month * payment_record.months - payment_record.discount;
  if payment_record.total_amount <> expected_total then raise exception 'Tổng tiền không khớp giá, số tháng và giảm giá.'; end if;

  if lower(kiosk_record.status) in ('active', 'warning')
    and kiosk_record.end_date is not null
    and kiosk_record.end_date >= confirmation_date then
    effective_start_date := kiosk_record.end_date + 1;
  else
    effective_start_date := confirmation_date;
  end if;
  calculated_end_date := (effective_start_date + make_interval(months => payment_record.months))::date;

  perform set_config('app.payment_workflow_action', 'confirm', true);
  update public.payments set payment_status = 'completed', confirmed_by = null,
    confirmed_at = confirmation_timestamp, start_date = effective_start_date,
    end_date = calculated_end_date
  where id = payment_record.id returning * into payment_record;
  update public.kiosks set status = 'active', start_date = effective_start_date,
    end_date = calculated_end_date where id = kiosk_record.id;
  update public.customers set
    status = case when lower(coalesce(status, '')) = 'pending' then 'active' else status end,
    total_kiosks = (select count(*) from public.kiosks k where k.customer_id = customer_record.id)
  where id = customer_record.id;

  perform private.write_ttc_audit('Payment','confirm_payos','payments',payment_record.id::text,
    to_jsonb(before_record),to_jsonb(payment_record),reason_input);
  return jsonb_build_object(
    'payment', to_jsonb(payment_record),
    'kiosk', (select to_jsonb(k) from public.kiosks k where k.id = kiosk_record.id),
    'customer', (select to_jsonb(c) from public.customers c where c.id = customer_record.id)
  );
end;
$function$;
