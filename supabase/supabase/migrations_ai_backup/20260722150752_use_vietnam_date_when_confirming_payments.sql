create or replace function private.complete_payment(payment_id_input bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  payment_record public.payments%rowtype;
  actor text;
  confirmation_date date;
  effective_start_date date;
  calculated_end_date date;
begin
  select *
  into payment_record
  from public.payments
  where id = payment_id_input
    and payment_status = 'pending'
  for update;

  if not found then
    raise exception 'Không tìm thấy thanh toán chờ xác nhận.';
  end if;

  actor := coalesce(auth.uid()::text, 'system');
  confirmation_date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  effective_start_date := greatest(
    coalesce(payment_record.start_date, confirmation_date),
    confirmation_date
  );

  if payment_record.months is not null and payment_record.months > 0 then
    calculated_end_date := (
      effective_start_date + make_interval(months => payment_record.months)
    )::date;
  else
    calculated_end_date := effective_start_date
      + greatest(
          coalesce(payment_record.end_date - payment_record.start_date, 0),
          0
        );
  end if;

  update public.payments
  set
    payment_status = 'completed',
    confirmed_by = actor,
    confirmed_at = now(),
    start_date = effective_start_date,
    end_date = calculated_end_date
  where id = payment_record.id;

  insert into public.logs(
    table_name, record_id, action, old_value, new_value,
    old_data, new_data, created_by, created_at
  )
  values(
    'payments',
    payment_record.id,
    'confirm_payment',
    jsonb_build_object(
      'payment_status', payment_record.payment_status,
      'start_date', payment_record.start_date,
      'end_date', payment_record.end_date
    ),
    jsonb_build_object(
      'payment_status', 'completed',
      'confirmed_by', actor,
      'confirmed_at', now(),
      'start_date', effective_start_date,
      'end_date', calculated_end_date
    ),
    jsonb_build_object(
      'payment_status', payment_record.payment_status,
      'start_date', payment_record.start_date,
      'end_date', payment_record.end_date
    ),
    jsonb_build_object(
      'payment_status', 'completed',
      'confirmed_by', actor,
      'confirmed_at', now(),
      'start_date', effective_start_date,
      'end_date', calculated_end_date
    ),
    actor,
    now()
  );
end;
$function$;
