
alter table public.payments
  add column if not exists counts_toward_revenue boolean not null default true,
  add column if not exists revenue_exclusion_reason text;

comment on column public.payments.counts_toward_revenue is
  'True only when the payment represents actual revenue. Legacy per-kiosk allocation rows must be false.';
comment on column public.payments.revenue_exclusion_reason is
  'Reason a completed payment record is retained in history but excluded from revenue totals.';

with duplicated_legacy_allocations as (
  select p.id
  from public.payments p
  where lower(p.payment_status) = 'completed'
    and p.payment_method = 'legacy'
    and p.note like 'Đồng bộ doanh thu từ Tổng đã thanh toán kiosk%'
    and exists (
      select 1
      from public.payments original
      where original.customer_id = p.customer_id
        and lower(original.payment_status) = 'completed'
        and original.payment_method = 'import_excel'
        and original.note like 'Tổng thanh toán của khách hàng cho toàn bộ kiosk%'
    )
)
update public.payments p
set counts_toward_revenue = false,
    revenue_exclusion_reason =
      'Phân bổ legacy theo kiosk; doanh thu đã được ghi nhận tại payment tổng của khách hàng.'
from duplicated_legacy_allocations d
where p.id = d.id;

create or replace view public.payment_business_dates
with (security_invoker = true)
as
select
  p.id,
  p.customer_id,
  p.kiosk_id,
  p.start_date,
  p.end_date,
  p.months,
  p.price_per_month,
  p.discount,
  p.discount_reason,
  p.total_amount,
  p.payment_method,
  p.payment_status,
  p.confirmed_by,
  p.note,
  p.created_at,
  p.confirmed_at,
  p.transaction_type,
  p.adjusts_payment_id,
  p.adjustment_reason,
  p.service_month_delta,
  p.payos_order_code,
  p.payos_payment_link_id,
  p.payos_checkout_url,
  p.payos_expire_at,
  p.payos_amount_snapshot,
  p.payos_checkout_state,
  p.payos_claim_token,
  p.payos_claim_expires_at,
  p.payos_attempt,
  p.registration_request_id,
  p.payment_intent_key,
  p.registration_batch_id,
  case
    when lower(p.payment_status::text) = 'completed' then p.confirmed_at
    else p.created_at
  end as business_at,
  case
    when lower(p.payment_status::text) = 'completed'
      then (p.confirmed_at at time zone 'Asia/Ho_Chi_Minh')::date
    else null::date
  end as revenue_date
from public.payments p
where p.counts_toward_revenue = true;

do $$
declare customer_record record;
begin
  for customer_record in
    select distinct p.customer_id
    from public.payments p
    where p.counts_toward_revenue = false
      and p.revenue_exclusion_reason =
        'Phân bổ legacy theo kiosk; doanh thu đã được ghi nhận tại payment tổng của khách hàng.'
  loop
    perform private.recalculate_customer_payment_total(customer_record.customer_id);
  end loop;
end
$$;
;
