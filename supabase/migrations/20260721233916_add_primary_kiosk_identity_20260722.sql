
alter table public.kiosks
add column if not exists is_primary boolean not null default false;

comment on column public.kiosks.is_primary is
'Kiosk Facebook chính được dùng làm thông tin đại diện của khách hàng';

create unique index if not exists one_primary_kiosk_per_customer
on public.kiosks(customer_id)
where is_primary = true;
;
