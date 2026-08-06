-- Read-only audit for CRM/Kiosk payments, PayOS orders, and TTC wallet data.
-- Run in Supabase SQL editor after deploying the PayOS + TTC migrations.

select
  to_regclass('public.payments') as payments_table,
  to_regclass('public.customers') as customers_table,
  to_regclass('public.kiosks') as kiosks_table,
  to_regclass('public.payos_orders') as payos_orders_table,
  to_regclass('public.wallets') as wallets_table,
  to_regclass('public.wallet_ledger') as wallet_ledger_table,
  to_regclass('public.ttc_campaigns') as ttc_campaigns_table,
  to_regclass('public.ttc_tasks') as ttc_tasks_table;

-- Completed payment must have confirmed_at and should have activated the linked kiosk.
select
  'completed_payment_without_active_kiosk' as issue_code,
  p.id as payment_id,
  p.customer_id,
  p.kiosk_id,
  p.payment_status,
  p.confirmed_at,
  p.total_amount,
  k.status as kiosk_status,
  k.start_date as kiosk_start_date,
  k.end_date as kiosk_end_date
from public.payments p
left join public.kiosks k on k.id = p.kiosk_id
where lower(coalesce(p.payment_status, '')) = 'completed'
  and coalesce(to_jsonb(p)->>'transaction_type', 'standard') = 'standard'
  and (
    p.confirmed_at is null
    or k.id is null
    or lower(coalesce(k.status, '')) <> 'active'
    or k.start_date is null
    or k.end_date is null
  )
order by p.confirmed_at desc nulls last, p.id desc;

-- Active kiosk should have at least one completed standard payment unless it was materialized from legacy data.
select
  'active_kiosk_without_completed_payment' as issue_code,
  k.id as kiosk_id,
  k.customer_id,
  k.facebook_name,
  k.facebook_id,
  k.status,
  k.start_date,
  k.end_date,
  k.total_paid,
  k.kiosk_total_paid
from public.kiosks k
where lower(coalesce(k.status, '')) = 'active'
  and not exists (
    select 1
    from public.payments p
    where p.kiosk_id = k.id
      and lower(coalesce(p.payment_status, '')) = 'completed'
      and p.confirmed_at is not null
      and coalesce(to_jsonb(p)->>'transaction_type', 'standard') = 'standard'
  )
order by k.updated_at desc nulls last, k.id desc;

-- Customer cached total_paid should match completed payment history.
select
  'customer_total_paid_mismatch' as issue_code,
  c.id as customer_id,
  c.facebook_name,
  c.total_paid as cached_total_paid,
  coalesce(sum(p.total_amount) filter (
    where lower(coalesce(p.payment_status, '')) = 'completed'
      and p.confirmed_at is not null
  ), 0) as actual_completed_total
from public.customers c
left join public.payments p on p.customer_id = c.id
group by c.id, c.facebook_name, c.total_paid
having coalesce(c.total_paid, 0) <> coalesce(sum(p.total_amount) filter (
  where lower(coalesce(p.payment_status, '')) = 'completed'
    and p.confirmed_at is not null
), 0)
order by c.id desc;

-- PayOS paid order should point to a processed CRM payment or wallet ledger entry.
select
  'payos_paid_order_without_target_effect' as issue_code,
  po.id as payos_order_id,
  po.order_code,
  po.purpose,
  po.payment_id,
  po.wallet_user_id,
  po.amount,
  po.status,
  p.payment_status,
  p.confirmed_at,
  wl.id as wallet_ledger_id
from public.payos_orders po
left join public.payments p on p.id = po.payment_id
left join public.wallet_ledger wl
  on wl.related_table = 'payos_orders'
  and wl.related_id = po.id::text
  and wl.idempotency_key = 'payos-paid:' || po.order_code::text
where po.status = 'paid'
  and (
    (po.purpose = 'crm_payment' and (
      p.id is null
      or lower(coalesce(p.payment_status, '')) <> 'completed'
      or p.confirmed_at is null
    ))
    or
    (po.purpose = 'wallet_topup' and wl.id is null)
  )
order by po.processed_at desc nulls last, po.id desc;

-- Wallet cached balance should equal wallet_ledger sum.
select
  'wallet_balance_mismatch' as issue_code,
  w.user_id,
  w.balance as cached_balance,
  coalesce(sum(wl.amount), 0) as ledger_balance
from public.wallets w
left join public.wallet_ledger wl on wl.wallet_user_id = w.user_id
group by w.user_id, w.balance
having coalesce(w.balance, 0) <> coalesce(sum(wl.amount), 0)
order by w.updated_at desc;

-- TTC campaign counters should match task state.
select
  'ttc_campaign_counter_mismatch' as issue_code,
  c.id as campaign_id,
  c.status,
  c.target_quantity,
  c.completed_quantity as cached_completed_quantity,
  count(t.id) filter (where t.status = 'completed') as actual_completed_quantity,
  c.spent_amount as cached_spent_amount,
  coalesce(sum(t.reward_amount) filter (where t.status = 'completed'), 0) as actual_spent_amount
from public.ttc_campaigns c
left join public.ttc_tasks t on t.campaign_id = c.id
group by c.id, c.status, c.target_quantity, c.completed_quantity, c.spent_amount
having c.completed_quantity <> count(t.id) filter (where t.status = 'completed')
  or c.spent_amount <> coalesce(sum(t.reward_amount) filter (where t.status = 'completed'), 0)
order by c.updated_at desc;
