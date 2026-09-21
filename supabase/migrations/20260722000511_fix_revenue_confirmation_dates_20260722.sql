
create table if not exists backup_20260722_before_reimport.payments_before_revenue_date_fix
as table public.payments;

alter table public.payments
add column if not exists confirmed_at timestamptz;

comment on column public.payments.created_at is
'Thời điểm khách gửi hoặc hệ thống tạo yêu cầu thanh toán';

comment on column public.payments.confirmed_at is
'Thời điểm admin xác nhận thanh toán; dùng để ghi nhận doanh thu';

update public.payments
set
  confirmed_at = start_date::timestamp at time zone 'Europe/Berlin',
  created_at = start_date::timestamp at time zone 'Europe/Berlin'
where payment_status = 'completed'
  and payment_method = 'import_excel';

alter table public.payments
alter column payment_status set default 'pending';

create or replace function public.handle_payment_success_logic()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.payment_status = 'completed'
     and (tg_op = 'INSERT' or old.payment_status is distinct from 'completed') then

    if new.kiosk_id is not null then
      update public.kiosks
      set
        start_date = new.start_date,
        end_date = new.end_date,
        status = 'active',
        total_paid = new.total_amount,
        kiosk_total_paid = (
          select coalesce(sum(p.total_amount),0)
          from public.payments p
          where p.kiosk_id = new.kiosk_id
            and p.payment_status = 'completed'
        ),
        last_payment_date = new.start_date,
        updated_at = now()
      where id = new.kiosk_id;
    end if;

    update public.customers
    set
      status = case when status = 'pending' then 'active' else status end,
      total_paid = (
        select coalesce(sum(p.total_amount),0)
        from public.payments p
        where p.customer_id = new.customer_id
          and p.payment_status = 'completed'
      ),
      last_payment_date = new.start_date,
      updated_at = now()
    where id = new.customer_id;
  end if;

  return new;
end;
$function$;

create or replace function public.confirm_payment(payment_id_input bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  payment_record public.payments%rowtype;
  actor text;
  confirmation_date date;
  calculated_end_date date;
begin
  select *
  into payment_record
  from public.payments
  where id = payment_id_input
    and payment_status = 'pending'
  for update;

  if not found then
    return;
  end if;

  actor := coalesce(auth.uid()::text,'system');
  confirmation_date := (now() at time zone 'Europe/Berlin')::date;

  if payment_record.months is not null and payment_record.months > 0 then
    calculated_end_date :=
      (confirmation_date + make_interval(months => payment_record.months))::date;
  else
    calculated_end_date :=
      confirmation_date + greatest(payment_record.end_date - payment_record.start_date,0);
  end if;

  update public.payments
  set
    payment_status = 'completed',
    confirmed_by = actor,
    confirmed_at = now(),
    start_date = confirmation_date,
    end_date = calculated_end_date
  where id = payment_record.id;

  insert into public.logs(
    table_name,record_id,action,old_value,new_value,
    old_data,new_data,created_by,created_at
  )
  values(
    'payments',
    payment_record.id,
    'confirm_payment',
    jsonb_build_object(
      'payment_status',payment_record.payment_status,
      'start_date',payment_record.start_date,
      'end_date',payment_record.end_date
    ),
    jsonb_build_object(
      'payment_status','completed',
      'confirmed_by',actor,
      'confirmed_at',now(),
      'start_date',confirmation_date,
      'end_date',calculated_end_date
    ),
    jsonb_build_object(
      'payment_status',payment_record.payment_status,
      'start_date',payment_record.start_date,
      'end_date',payment_record.end_date
    ),
    jsonb_build_object(
      'payment_status','completed',
      'confirmed_by',actor,
      'confirmed_at',now(),
      'start_date',confirmation_date,
      'end_date',calculated_end_date
    ),
    actor,
    now()
  );
end;
$function$;

create or replace function public.get_monthly_revenue()
returns numeric
language sql
stable
set search_path = ''
as $function$
  select coalesce(sum(total_amount),0)
  from public.payments
  where payment_status = 'completed'
    and date_trunc('month',confirmed_at at time zone 'Europe/Berlin')
      = date_trunc('month',now() at time zone 'Europe/Berlin');
$function$;

create or replace function public.get_yearly_revenue(year_input integer)
returns numeric
language sql
stable
set search_path = ''
as $function$
  select coalesce(sum(total_amount),0)
  from public.payments
  where payment_status = 'completed'
    and extract(year from confirmed_at at time zone 'Europe/Berlin') = year_input;
$function$;
;
