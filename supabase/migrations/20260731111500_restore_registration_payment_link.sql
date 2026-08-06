-- Restore the registration -> payment link that exists in the legacy backup
-- migrations, but may be missing from the active migration chain.
alter table public.registration_requests
  add column if not exists payment_id bigint
  references public.payments(id) on delete restrict;

create index if not exists registration_requests_payment_idx
  on public.registration_requests(payment_id);

create or replace function private.link_registration_request_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.payment_id is null and new.kiosk_id is not null and new.customer_id is not null then
    select p.id
    into new.payment_id
    from public.payments p
    where p.kiosk_id = new.kiosk_id
      and p.customer_id = new.customer_id
      and lower(p.payment_status) = 'pending'
      and coalesce(p.transaction_type, 'standard') = 'standard'
      and (new.months is null or p.months = new.months)
      and (new.total_amount is null or p.total_amount = new.total_amount)
    order by p.created_at desc, p.id desc
    limit 1;
  end if;
  return new;
end;
$function$;

drop trigger if exists link_registration_request_payment_trigger
  on public.registration_requests;
create trigger link_registration_request_payment_trigger
before insert on public.registration_requests
for each row execute function private.link_registration_request_payment();

create or replace function private.registration_request_payment(
  request_record public.registration_requests
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $function$
declare
  resolved_payment_id bigint;
  candidate_count integer;
begin
  if request_record.payment_id is not null then
    return request_record.payment_id;
  end if;

  select count(*), min(p.id)
  into candidate_count, resolved_payment_id
  from public.payments p
  where p.kiosk_id = request_record.kiosk_id
    and p.customer_id = request_record.customer_id
    and lower(p.payment_status) = 'pending'
    and coalesce(p.transaction_type, 'standard') = 'standard'
    and (request_record.months is null or p.months = request_record.months)
    and (request_record.total_amount is null or p.total_amount = request_record.total_amount);

  if candidate_count <> 1 then
    raise exception 'Không xác định được duy nhất thanh toán Pending của đơn đăng ký.'
      using errcode = 'P0001';
  end if;

  return resolved_payment_id;
end;
$function$;

revoke all on function private.link_registration_request_payment() from public;
revoke all on function private.registration_request_payment(public.registration_requests) from public;
