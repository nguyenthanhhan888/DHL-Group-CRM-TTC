-- Keep registration-batch completion isolated from legacy one-payment/one-kiosk
-- behavior. Historical rows are intentionally not rewritten by this migration.

-- This trigger predates the authoritative payment workflow and treats
-- payments.kiosk_id as the payment's only kiosk. Modern confirmation functions
-- and synchronization triggers fully replace it for single-kiosk payments.
drop trigger if exists trg_payment_success on public.payments;

create or replace function private.recalculate_kiosk_payment_total(kiosk_id_input bigint)
returns void
language sql
security definer
set search_path = ''
as $function$
  with kiosk_ledger as (
    select
      p.total_amount as amount,
      (p.confirmed_at at time zone 'Asia/Ho_Chi_Minh')::date as paid_on
    from public.payments p
    where p.registration_batch_id is null
      and p.kiosk_id = kiosk_id_input
      and pg_catalog.lower(coalesce(p.payment_status, '')) = 'completed'
      and p.confirmed_at is not null

    union all

    select
      i.total_amount as amount,
      (p.confirmed_at at time zone 'Asia/Ho_Chi_Minh')::date as paid_on
    from public.registration_batch_items i
    join public.registration_batches b on b.id = i.batch_id
    join public.payments p on p.id = b.payment_id
    where i.kiosk_id = kiosk_id_input
      and p.registration_batch_id = b.id
      and pg_catalog.lower(coalesce(p.payment_status, '')) = 'completed'
      and p.confirmed_at is not null
  ), totals as (
    select coalesce(sum(amount), 0) as amount, max(paid_on) as paid_on
    from kiosk_ledger
  )
  update public.kiosks k
  set
    total_paid = totals.amount,
    kiosk_total_paid = totals.amount,
    last_payment_date = totals.paid_on
  from totals
  where k.id = kiosk_id_input;
$function$;

create or replace function private.sync_completed_payment_totals()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  affected_kiosk_id bigint;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    if old.customer_id is not null then
      perform private.recalculate_customer_payment_total(old.customer_id);
    end if;
    if old.registration_batch_id is not null then
      for affected_kiosk_id in
        select distinct i.kiosk_id
        from public.registration_batch_items i
        where i.batch_id = old.registration_batch_id
      loop
        perform private.recalculate_kiosk_payment_total(affected_kiosk_id);
      end loop;
    elsif old.kiosk_id is not null then
      perform private.recalculate_kiosk_payment_total(old.kiosk_id);
    end if;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    if new.customer_id is not null then
      perform private.recalculate_customer_payment_total(new.customer_id);
    end if;
    if new.registration_batch_id is not null then
      for affected_kiosk_id in
        select distinct i.kiosk_id
        from public.registration_batch_items i
        where i.batch_id = new.registration_batch_id
      loop
        perform private.recalculate_kiosk_payment_total(affected_kiosk_id);
      end loop;
    elsif new.kiosk_id is not null then
      perform private.recalculate_kiosk_payment_total(new.kiosk_id);
    end if;
    return new;
  end if;

  return old;
end;
$function$;

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
    set status = 'active', start_date = new.start_date, end_date = new.end_date
    where id = new.kiosk_id;
  end if;
  return null;
end;
$function$;

create or replace function private.sync_registration_period_from_completed_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.registration_batch_id is null
    and old.payment_status = 'pending'
    and new.payment_status = 'completed'
    and new.start_date is not null
    and new.end_date is not null then
    update public.registration_requests
    set requested_start_date = new.start_date,
        requested_end_date = new.end_date
    where payment_id = new.id;
  end if;
  return new;
end;
$function$;

revoke all on function private.recalculate_kiosk_payment_total(bigint) from public;
revoke all on function private.sync_completed_payment_totals() from public;
revoke all on function private.sync_completed_renewal_kiosk_period() from public;
revoke all on function private.sync_registration_period_from_completed_payment() from public;
