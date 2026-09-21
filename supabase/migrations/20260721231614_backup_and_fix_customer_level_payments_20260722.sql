
create schema if not exists backup_20260722_before_reimport;

create table backup_20260722_before_reimport.customers as table public.customers;
create table backup_20260722_before_reimport.kiosks as table public.kiosks;
create table backup_20260722_before_reimport.payments as table public.payments;
create table backup_20260722_before_reimport.logs as table public.logs;
create table backup_20260722_before_reimport.sheet_import as table public.sheet_import;

alter table public.customers alter column phone drop not null;
alter table public.payments alter column kiosk_id drop not null;
alter table public.payments alter column payment_status set default 'completed';
alter table public.payments drop constraint if exists payments_payment_status_check;
alter table public.payments add constraint payments_payment_status_check
  check (payment_status::text = any (array['pending','completed','rejected','cancelled']::text[]));

alter table public.kiosks add column if not exists service_name text;
comment on column public.kiosks.service_name is 'Tên dịch vụ/ngành hàng gốc từ dữ liệu nguồn';

create or replace function public.handle_payment_success_logic()
returns trigger
language plpgsql
as $function$
begin
  if new.payment_status = 'completed' then
    if new.kiosk_id is not null then
      update public.kiosks
      set
        start_date = new.start_date,
        end_date = new.end_date,
        total_paid = new.total_amount,
        kiosk_total_paid = (
          select coalesce(sum(total_amount), 0)
          from public.payments
          where kiosk_id = new.kiosk_id
            and payment_status = 'completed'
        )
      where id = new.kiosk_id;
    end if;

    update public.customers
    set
      total_paid = (
        select coalesce(sum(total_amount), 0)
        from public.payments
        where customer_id = new.customer_id
          and payment_status = 'completed'
      ),
      last_payment_date = new.start_date
    where id = new.customer_id;
  end if;

  return new;
end;
$function$;
;
