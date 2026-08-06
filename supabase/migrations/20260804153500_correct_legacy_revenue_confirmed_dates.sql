-- Legacy/backfill revenue should be recognized on the kiosk service start date.
-- Completed payment rows are normally immutable. This migration performs a
-- narrow, transactional correction for generated legacy sync rows only.

do $$
begin
  if exists (
    select 1
    from pg_catalog.pg_trigger
    where tgname = 'protect_payment_records_trigger'
      and tgrelid = 'public.payments'::regclass
  ) then
    alter table public.payments disable trigger protect_payment_records_trigger;
  end if;
end $$;

update public.payments p
set confirmed_at = k.start_date::timestamp at time zone 'Asia/Ho_Chi_Minh'
from public.kiosks k
where p.kiosk_id = k.id
  and p.payment_method = 'legacy'
  and lower(coalesce(p.payment_status, '')) = 'completed'
  and p.confirmed_at is not null
  and k.start_date is not null
  and p.note like 'Đồng bộ doanh thu từ Tổng đã thanh toán kiosk #%'
  and (p.confirmed_at at time zone 'Asia/Ho_Chi_Minh')::date <> k.start_date;

do $$
begin
  if exists (
    select 1
    from pg_catalog.pg_trigger
    where tgname = 'protect_payment_records_trigger'
      and tgrelid = 'public.payments'::regclass
  ) then
    alter table public.payments enable trigger protect_payment_records_trigger;
  end if;
end $$;

update public.kiosks k
set last_payment_date = payment_totals.last_payment_date
from (
  select
    p.kiosk_id,
    max((p.confirmed_at at time zone 'Asia/Ho_Chi_Minh')::date) as last_payment_date
  from public.payments p
  where lower(coalesce(p.payment_status, '')) = 'completed'
    and p.confirmed_at is not null
  group by p.kiosk_id
) payment_totals
where k.id = payment_totals.kiosk_id;

update public.customers c
set
  last_payment_date = payment_totals.last_payment_date,
  updated_at = pg_catalog.now()
from (
  select
    p.customer_id,
    max((p.confirmed_at at time zone 'Asia/Ho_Chi_Minh')::date) as last_payment_date
  from public.payments p
  where lower(coalesce(p.payment_status, '')) = 'completed'
    and p.confirmed_at is not null
  group by p.customer_id
) payment_totals
where c.id = payment_totals.customer_id;
