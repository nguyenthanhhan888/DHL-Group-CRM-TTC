-- Audited against the production schema on 2026-09-10. Apply manually after QA.
-- No deletions, no changes to historical payment amounts or recognition dates.
begin;
-- Registration is a separate lifecycle from a registered kiosk's service status.
-- Established legacy/imported periods remain valid when there is no unpaid public request.
create or replace view public.kiosk_lifecycle with (security_invoker = true) as
select k.*,
  case
    when exists (select 1 from public.payments p where p.kiosk_id=k.id
      and p.registration_batch_id is null and p.payment_status='completed' and p.confirmed_at is not null)
      or exists (select 1 from public.registration_batch_items i join public.payments p on p.registration_batch_id=i.batch_id
        where i.kiosk_id=k.id and p.payment_status='completed' and p.confirmed_at is not null)
      then 'registered'
    when exists (select 1 from public.registration_requests r where r.kiosk_id=k.id
      and r.status in ('cancelled','rejected')) then 'cancelled'
    when exists (select 1 from public.registration_requests r where r.kiosk_id=k.id
      and r.status in ('pending','awaiting_payment','submitted','payment_pending')) then 'unpaid'
    when k.start_date is not null and k.end_date is not null and lower(k.status)<>'pending' then 'registered'
    else 'unpaid'
  end::text as registration_state
from public.kiosks k;
create or replace view public.registered_kiosks with (security_invoker = true) as
select * from public.kiosk_lifecycle where registration_state='registered';
revoke all on public.kiosk_lifecycle, public.registered_kiosks from anon;
grant select on public.kiosk_lifecycle, public.registered_kiosks to authenticated, service_role;
-- Financial source of truth: completed + confirmed_at, Vietnam calendar, [from,to).
create or replace view public.payment_business_dates with (security_invoker = true) as
select p.*,
  case when lower(p.payment_status)='completed' then p.confirmed_at else p.created_at end as business_at,
  case when lower(p.payment_status)='completed' then (p.confirmed_at at time zone 'Asia/Ho_Chi_Minh')::date end as revenue_date
from public.payments p;
revoke all on public.payment_business_dates from anon;
grant select on public.payment_business_dates to authenticated, service_role;
-- Avoid no-op legacy trigger events; actual technical changes remain traceable.
create or replace function private.payment_totals_changed(old_row public.payments, new_row public.payments)
returns boolean language sql immutable set search_path='' as $$
  select (old_row.customer_id,old_row.kiosk_id,old_row.registration_batch_id,old_row.payment_status,old_row.total_amount,old_row.confirmed_at)
    is distinct from
    (new_row.customer_id,new_row.kiosk_id,new_row.registration_batch_id,new_row.payment_status,new_row.total_amount,new_row.confirmed_at)
$$;
revoke all on function private.payment_totals_changed(public.payments,public.payments) from public;
-- Business event selection happens before pagination. Never infer business intent
-- from UPDATE alone: legacy trigger rows have legacy_log_id or explicit provenance.
create or replace function private.is_business_audit(action_value text, entity_value text,
  legacy_id bigint, reason_value text, before_value jsonb, after_value jsonb)
returns boolean language sql immutable set search_path='' as $$
  select legacy_id is null and coalesce(reason_value,'') <> 'Mirrored from legacy logs'
    and lower(coalesce(action_value,'')) = any(array[
      'create','update','delete','confirm','cancel','reject','approve','approved',
      'set_active','reset_password','update_profile','admin_reset_user_password',
      'admin_update_user_profile','admin_update_user_status','sync_permissions','lock_user','unlock_user',
      'adjust_wallet','admin_adjustment','admin_manual_renewal','confirm_payos','confirm_payos_batch',
      'admin_cancel','review_legacy_approve','review_legacy_cancel','create_promotion','update_promotion',
      'pause_promotion','reactivate_promotion','delete_promotion','expire','expired','activate','deactivate',
      'registration_pending','renewal_pending','renewal_paid','payment_review_required'
    ])
    and not (lower(coalesce(action_value,''))='update'
      and (coalesce(before_value,'{}'::jsonb)-array['updated_at','total_paid','kiosk_total_paid','total_kiosks','last_payment_date'])
        is not distinct from (coalesce(after_value,'{}'::jsonb)-array['updated_at','total_paid','kiosk_total_paid','total_kiosks','last_payment_date']))
$$;
revoke all on function private.is_business_audit(text,text,bigint,text,jsonb,jsonb) from public;
create or replace function private.business_activity(action_value text, category_value text, after_value jsonb)
returns text language sql immutable set search_path='' as $$
  select case
    when lower(action_value) in ('registration_pending','review_legacy_approve','review_legacy_cancel','admin_cancel') then 'registration'
    when lower(action_value) like '%renewal%' then 'renewal'
    when category_value='user' then 'user'
    when lower(action_value) in ('deactivate','pause_promotion') or (lower(action_value)='update' and after_value->>'status' in ('inactive','suspended')) then 'suspension'
    when lower(action_value)='update' or after_value->>'correction_type'='historical_payment' then 'edit'
    when category_value='payment' then 'payment'
    when category_value='kiosk' and lower(action_value)='create' then 'registration'
    else 'edit' end
$$;
revoke all on function private.business_activity(text,text,jsonb) from public;
CREATE OR REPLACE FUNCTION public.get_dashboard_data(p_year integer DEFAULT (EXTRACT(year FROM (now() AT TIME ZONE 'Asia/Ho_Chi_Minh'::text)))::integer, p_month integer DEFAULT (EXTRACT(month FROM (now() AT TIME ZONE 'Asia/Ho_Chi_Minh'::text)))::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  result jsonb;
  warning_days integer;
  today_date date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  month_start timestamptz;
  next_month_start timestamptz;
  year_start timestamptz;
  next_year_start timestamptz;
begin
  if auth.uid() is null or not exists (
    select 1
    from public.user_roles ur
    where ur.user_id = auth.uid()
      and ur.is_active = true
      and (
        lower(ur.role) = 'admin'
        or exists (
          select 1
          from public.role_permissions rp
          where lower(rp.role) = lower(ur.role)
            and 'dashboard' = any(rp.permissions)
        )
      )
  ) then
    raise exception 'Không có quyền xem Dashboard.'
      using errcode = '42501';
  end if;

  if p_year is null or p_year < 1 or p_year > 9999 then
    raise exception 'Năm Dashboard không hợp lệ.';
  end if;

  if p_month is null or p_month < 1 or p_month > 12 then
    raise exception 'Tháng Dashboard không hợp lệ.';
  end if;

  select greatest(
    coalesce(case when s.value ~ '^\d+$' then s.value::integer end, 30),
    0
  )
  into warning_days
  from public.settings s
  where s.key = 'warning_days';

  warning_days := coalesce(warning_days, 30);
  month_start := make_timestamptz(p_year, p_month, 1, 0, 0, 0, 'Asia/Ho_Chi_Minh');
  next_month_start := ((make_date(p_year,p_month,1) + interval '1 month') at time zone 'Asia/Ho_Chi_Minh');
  year_start := make_timestamptz(p_year, 1, 1, 0, 0, 0, 'Asia/Ho_Chi_Minh');
  next_year_start := make_timestamptz(p_year+1,1,1,0,0,0,'Asia/Ho_Chi_Minh');

  with
  customer_kpis as (
    select count(*)::bigint as total_customers
    from public.customers
  ),
  kiosk_kpis as (
    select
      count(*)::bigint as total_kiosks,
      count(*) filter (where public.resolve_kiosk_status(status, end_date, warning_days, today_date) = 'active')::bigint as active_kiosks,
      count(*) filter (where public.resolve_kiosk_status(status, end_date, warning_days, today_date) = 'pending')::bigint as pending_kiosks,
      count(*) filter (where public.resolve_kiosk_status(status, end_date, warning_days, today_date) = 'expired')::bigint as expired_kiosks,
      count(*) filter (
        where public.resolve_kiosk_status(status, end_date, warning_days, today_date) = 'warning'
      )::bigint as expiring_soon
    from public.registered_kiosks
  ),
  revenue_kpis as (
    select
      coalesce(sum(total_amount) filter (
        where confirmed_at >= month_start
          and confirmed_at < next_month_start
      ), 0) as revenue_this_month,
      coalesce(sum(total_amount) filter (
        where confirmed_at >= year_start
          and confirmed_at < next_year_start
      ), 0) as revenue_this_year
    from public.payment_business_dates
    where lower(payment_status) = 'completed'
      and confirmed_at is not null
  ),
  monthly_revenue as (
    select jsonb_agg(
      jsonb_build_object('month', month_number - 1, 'total', total)
      order by month_number
    ) as data
    from (
      select
        month_number,
        coalesce(sum(p.total_amount), 0) as total
      from generate_series(1, 12) as months(month_number)
      left join public.payment_business_dates p
        on lower(p.payment_status) = 'completed'
        and p.confirmed_at is not null
        and p.confirmed_at >= make_timestamptz(p_year, month_number, 1, 0, 0, 0, 'Asia/Ho_Chi_Minh')
        and p.confirmed_at < ((make_date(p_year,month_number,1) + interval '1 month') at time zone 'Asia/Ho_Chi_Minh')
      group by month_number
    ) totals
  ),
  category_distribution as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object('name', name, 'count', kiosk_count)
        order by kiosk_count desc, name
      ),
      '[]'::jsonb
    ) as data
    from (
      select
        coalesce(c.name, 'Chưa phân loại') as name,
        count(*)::bigint as kiosk_count
      from public.registered_kiosks k
      left join public.categories c on c.id = k.category_id
      group by coalesce(c.name, 'Chưa phân loại')
    ) distribution
  ),
  expiring_kiosks as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', item.id,
          'facebook_name', item.facebook_name,
          'end_date', item.end_date,
          'customers', jsonb_build_object(
            'facebook_name', item.customer_name,
            'phone', item.customer_phone
          )
        )
        order by item.end_date, item.id
      ),
      '[]'::jsonb
    ) as data
    from (
      select
        k.id,
        k.facebook_name,
        k.end_date,
        c.facebook_name as customer_name,
        c.phone as customer_phone
      from public.registered_kiosks k
      left join public.customers c on c.id = k.customer_id
      where public.resolve_kiosk_status(k.status, k.end_date, warning_days, today_date) = 'warning'
      order by k.end_date, k.id
    ) item
  ),
  recent_registrations as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', item.id,
          'kioskName', item.kiosk_name,
          'amount', item.amount,
          'createdAt', item.created_at
        )
        order by item.created_at desc, item.id desc
      ),
      '[]'::jsonb
    ) as data
    from (
      select
        r.id,
        coalesce(nullif(k.facebook_name, ''), nullif(r.facebook_name, ''), 'Kiosk') as kiosk_name,
        case
          when bi.id is not null then bi.total_amount
          else coalesce(r.total_amount, 0)
        end as amount,
        r.submitted_at as created_at
      from public.registration_requests r
      left join public.registration_batch_items bi on bi.registration_request_id = r.id
      left join public.registered_kiosks k on k.id = coalesce(bi.kiosk_id, r.kiosk_id)
      order by r.submitted_at desc, r.id desc
      limit 5
    ) item
  )
  select jsonb_build_object(
    'summary', jsonb_build_object(
      'totalCustomers', coalesce(c.total_customers, 0),
      'totalKiosks', coalesce(k.total_kiosks, 0),
      'activeKiosks', coalesce(k.active_kiosks, 0),
      'pendingKiosks', coalesce(k.pending_kiosks, 0),
      'expiredKiosks', coalesce(k.expired_kiosks, 0),
      'expiringSoon', coalesce(k.expiring_soon, 0),
      'revenueThisMonth', coalesce(r.revenue_this_month, 0),
      'revenueThisYear', coalesce(r.revenue_this_year, 0)
    ),
    'charts', jsonb_build_object(
      'monthlyRevenue', coalesce(m.data, '[]'::jsonb),
      'categoryDistribution', coalesce(d.data, '[]'::jsonb)
    ),
    'lists', jsonb_build_object(
      'expiringKiosks', coalesce(e.data, '[]'::jsonb),
      'recentRegistrations', coalesce(rr.data, '[]'::jsonb)
    ),
    'year', p_year,
    'month', p_month,
    'warningDays', warning_days
  )
  into result
  from customer_kpis c
  cross join kiosk_kpis k
  cross join revenue_kpis r
  cross join monthly_revenue m
  cross join category_distribution d
  cross join expiring_kiosks e
  cross join recent_registrations rr;

  return coalesce(result, '{}'::jsonb);
end;
$function$;
CREATE OR REPLACE FUNCTION public.get_reports_data(p_report_type text DEFAULT 'overview'::text, p_start_date date DEFAULT NULL::date, p_end_date date DEFAULT NULL::date, p_customer_id bigint DEFAULT NULL::bigint, p_kiosk_id bigint DEFAULT NULL::bigint, p_category_id bigint DEFAULT NULL::bigint, p_business_type_id bigint DEFAULT NULL::bigint, p_payment_status text DEFAULT NULL::text, p_kiosk_status text DEFAULT NULL::text, p_sort_by text DEFAULT NULL::text, p_sort_direction text DEFAULT 'desc'::text, p_page integer DEFAULT 1, p_page_size integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  report_type text := lower(coalesce(p_report_type, ''));
  sort_direction text := lower(coalesce(p_sort_direction, 'desc'));
  warning_days integer;
  today_date date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  start_at timestamptz;
  end_at timestamptz;
  row_offset integer;
  result jsonb;
begin
  if auth.uid() is null or not exists (
    select 1
    from public.user_roles ur
    where ur.user_id = auth.uid()
      and ur.is_active = true
      and (
        lower(ur.role) = 'admin'
        or exists (
          select 1
          from public.role_permissions rp
          where lower(rp.role) = lower(ur.role)
            and 'reports' = any(rp.permissions)
        )
      )
  ) then
    raise exception 'Không có quyền xem Báo cáo.'
      using errcode = '42501';
  end if;

  if report_type not in (
    'overview', 'revenue', 'kiosks', 'customers', 'reconciliation', 'categories'
  ) then
    raise exception 'Loại báo cáo không hợp lệ.';
  end if;

  if p_page is null or p_page < 1 then
    raise exception 'Trang báo cáo không hợp lệ.';
  end if;

  if p_page_size is null or p_page_size not in (25, 50, 100) then
    raise exception 'Kích thước trang phải là 25, 50 hoặc 100.';
  end if;

  if sort_direction not in ('asc', 'desc') then
    raise exception 'Chiều sắp xếp không hợp lệ.';
  end if;

  if p_start_date is not null and p_end_date is not null and p_start_date > p_end_date then
    raise exception 'Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.';
  end if;

  select case
    when s.value ~ '^\d+$' and s.value::integer > 0 then s.value::integer
    else 30
  end
  into warning_days
  from public.settings s
  where s.key = 'warning_days';

  warning_days := coalesce(warning_days, 30);
  start_at := case
    when p_start_date is null then null
    else p_start_date::timestamp at time zone 'Asia/Ho_Chi_Minh'
  end;
  end_at := case
    when p_end_date is null then null
    else (p_end_date + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh'
  end;
  row_offset := (p_page - 1) * p_page_size;

  if report_type = 'overview' then
    with
    eligible_payments as (
      select p.*
      from public.payment_business_dates p
      left join public.registered_kiosks k on k.id = p.kiosk_id
      where lower(p.payment_status) = 'completed'
        and p.confirmed_at is not null
        and (start_at is null or p.confirmed_at >= start_at)
        and (end_at is null or p.confirmed_at < end_at)
        and (p_customer_id is null or p.customer_id = p_customer_id)
        and (p_kiosk_id is null or p.kiosk_id = p_kiosk_id)
        and (p_category_id is null or k.category_id = p_category_id)
        and (p_business_type_id is null or k.business_type_id = p_business_type_id)
        and (p_payment_status is null or lower(p.payment_status) = lower(p_payment_status))
        and (p_kiosk_status is null or public.resolve_kiosk_status(k.status, k.end_date, warning_days, today_date) = case when lower(p_kiosk_status) = 'expiring_soon' then 'warning' else lower(p_kiosk_status) end)
    ),
    operational_payments as (
      select p.*
      from public.payment_business_dates p
      left join public.registered_kiosks k on k.id = p.kiosk_id
      where (
          (lower(p.payment_status) = 'completed' and p.confirmed_at is not null
            and (start_at is null or p.confirmed_at >= start_at)
            and (end_at is null or p.confirmed_at < end_at))
          or
          (lower(p.payment_status) <> 'completed'
            and (start_at is null or p.created_at >= start_at)
            and (end_at is null or p.created_at < end_at))
        )
        and (p_customer_id is null or p.customer_id = p_customer_id)
        and (p_kiosk_id is null or p.kiosk_id = p_kiosk_id)
        and (p_category_id is null or k.category_id = p_category_id)
        and (p_business_type_id is null or k.business_type_id = p_business_type_id)
        and (p_payment_status is null or lower(p.payment_status) = lower(p_payment_status))
        and (p_kiosk_status is null or public.resolve_kiosk_status(k.status, k.end_date, warning_days, today_date) = case when lower(p_kiosk_status) = 'expiring_soon' then 'warning' else lower(p_kiosk_status) end)
    ),
    filtered_kiosks as (
      select k.*
      from public.registered_kiosks k
      where (p_customer_id is null or k.customer_id = p_customer_id)
        and (p_kiosk_id is null or k.id = p_kiosk_id)
        and (p_category_id is null or k.category_id = p_category_id)
        and (p_business_type_id is null or k.business_type_id = p_business_type_id)
        and (
          p_kiosk_status is null
          or (lower(p_kiosk_status) = 'expiring_soon'
            and public.resolve_kiosk_status(k.status, k.end_date, warning_days, today_date) = 'warning')
          or public.resolve_kiosk_status(k.status, k.end_date, warning_days, today_date) = case when lower(p_kiosk_status) = 'expiring_soon' then 'warning' else lower(p_kiosk_status) end
        )
    ),
    payment_summary as (
      select
        coalesce(sum(total_amount), 0) as total_revenue,
        count(*)::bigint as completed_count
      from eligible_payments
    ),
    operational_summary as (
      select
        count(*) filter (where lower(payment_status) = 'pending')::bigint as pending_count,
        coalesce(sum(total_amount) filter (where lower(payment_status) = 'pending'), 0) as pending_amount,
        count(*) filter (where lower(payment_status) = 'rejected')::bigint as rejected_count,
        count(*) filter (where lower(payment_status) = 'cancelled')::bigint as cancelled_count
      from operational_payments
    ),
    kiosk_summary as (
      select
        count(*)::bigint as total_kiosks,
        count(*) filter (where public.resolve_kiosk_status(status, end_date, warning_days, today_date) = 'active')::bigint as active_kiosks,
        count(*) filter (where public.resolve_kiosk_status(status, end_date, warning_days, today_date) = 'pending')::bigint as pending_kiosks,
        count(*) filter (where public.resolve_kiosk_status(status, end_date, warning_days, today_date) = 'expired')::bigint as expired_kiosks,
        count(*) filter (where public.resolve_kiosk_status(status, end_date, warning_days, today_date) = 'suspended')::bigint as suspended_kiosks,
        count(*) filter (
          where public.resolve_kiosk_status(status, end_date, warning_days, today_date) = 'warning'
        )::bigint as expiring_soon
      from filtered_kiosks
    ),
    top_customers as (
      select coalesce(jsonb_agg(to_jsonb(item) order by item."totalAmount" desc), '[]'::jsonb) as data
      from (
        select
          p.customer_id as "customerId",
          coalesce(c.facebook_name, 'Không tên') as "customerName",
          coalesce(c.phone, '') as phone,
          count(*)::bigint as "paymentCount",
          coalesce(sum(p.total_amount), 0) as "totalAmount"
        from eligible_payments p
        left join public.customers c on c.id = p.customer_id
        group by p.customer_id, c.facebook_name, c.phone
        order by "totalAmount" desc, "customerId"
        limit 10
      ) item
    ),
    priority_kiosks as (
      select coalesce(jsonb_agg(to_jsonb(item) order by item."sortPriority", item."daysLeft"), '[]'::jsonb) as data
      from (
        select
          k.id,
          coalesce(k.facebook_name, 'Không tên') as "facebookName",
          coalesce(c.facebook_name, '') as "customerName",
          k.end_date as "endDate",
          case
            when public.resolve_kiosk_status(k.status, k.end_date, warning_days, today_date) = 'pending' then 'pending'
            when public.resolve_kiosk_status(k.status, k.end_date, warning_days, today_date) = 'expired' then 'expired'
            when public.resolve_kiosk_status(k.status, k.end_date, warning_days, today_date) = 'warning' then 'warning'
            else lower(coalesce(k.status, 'unknown'))
          end as "derivedStatus",
          k.end_date - today_date as "daysLeft",
          case
            when public.resolve_kiosk_status(k.status, k.end_date, warning_days, today_date) = 'pending' then 0
            when public.resolve_kiosk_status(k.status, k.end_date, warning_days, today_date) = 'expired' then 1
            else 2
          end as "sortPriority"
        from filtered_kiosks k
        left join public.customers c on c.id = k.customer_id
        where lower(k.status) in ('pending', 'expired')
          or (public.resolve_kiosk_status(k.status, k.end_date, warning_days, today_date) = 'warning')
        order by "sortPriority", "daysLeft" nulls last, k.id
        limit 10
      ) item
    )
    select jsonb_build_object(
      'tab', report_type,
      'generatedAt', now(),
      'summary', jsonb_build_object(
        'totalRevenue', coalesce(ps.total_revenue, 0),
        'completedCount', coalesce(ps.completed_count, 0),
        'pendingCount', coalesce(os.pending_count, 0),
        'pendingAmount', coalesce(os.pending_amount, 0),
        'rejectedCount', coalesce(os.rejected_count, 0),
        'cancelledCount', coalesce(os.cancelled_count, 0),
        'totalKiosks', coalesce(ks.total_kiosks, 0),
        'activeKiosks', coalesce(ks.active_kiosks, 0),
        'pendingKiosks', coalesce(ks.pending_kiosks, 0),
        'expiredKiosks', coalesce(ks.expired_kiosks, 0),
        'suspendedKiosks', coalesce(ks.suspended_kiosks, 0),
        'expiringSoon', coalesce(ks.expiring_soon, 0)
      ),
      'topCustomers', tc.data,
      'priorityKiosks', pk.data,
      'rows', '[]'::jsonb,
      'pagination', jsonb_build_object(
        'page', p_page, 'pageSize', p_page_size, 'totalRows', 0, 'totalPages', 0
      )
    )
    into result
    from payment_summary ps
    cross join operational_summary os
    cross join kiosk_summary ks
    cross join top_customers tc
    cross join priority_kiosks pk;

  elsif report_type = 'revenue' then
    with
    filtered as (
      select
        p.id,
        p.customer_id,
        p.kiosk_id,
        p.confirmed_at,
        p.total_amount,
        p.payment_method,
        c.facebook_name as customer_name,
        k.facebook_name as kiosk_name,
        k.category_id,
        k.business_type_id,
        ca.name as category_name,
        bt.name as business_type_name
      from public.payment_business_dates p
      left join public.customers c on c.id = p.customer_id
      left join public.registered_kiosks k on k.id = p.kiosk_id
      left join public.categories ca on ca.id = k.category_id
      left join public.business_types bt on bt.id = k.business_type_id
      where lower(p.payment_status) = 'completed'
        and p.confirmed_at is not null
        and (start_at is null or p.confirmed_at >= start_at)
        and (end_at is null or p.confirmed_at < end_at)
        and (p_customer_id is null or p.customer_id = p_customer_id)
        and (p_kiosk_id is null or p.kiosk_id = p_kiosk_id)
        and (p_category_id is null or k.category_id = p_category_id)
        and (p_business_type_id is null or k.business_type_id = p_business_type_id)
        and (p_payment_status is null or lower(p.payment_status) = lower(p_payment_status))
        and (p_kiosk_status is null or public.resolve_kiosk_status(k.status, k.end_date, warning_days, today_date) = case when lower(p_kiosk_status) = 'expiring_soon' then 'warning' else lower(p_kiosk_status) end)
    ),
    summary as (
      select
        coalesce(sum(total_amount), 0) as total_revenue,
        count(*)::bigint as completed_count,
        coalesce(avg(total_amount), 0) as average_payment,
        coalesce(max(total_amount), 0) as highest_payment,
        coalesce(min(total_amount), 0) as lowest_payment
      from filtered
    ),
    monthly as (
      select coalesce(jsonb_agg(to_jsonb(item) order by item.key), '[]'::jsonb) as data
      from (
        select
          to_char(confirmed_at at time zone 'Asia/Ho_Chi_Minh', 'YYYY-MM') as key,
          'Tháng ' || to_char(confirmed_at at time zone 'Asia/Ho_Chi_Minh', 'MM/YYYY') as label,
          count(*)::bigint as "paymentCount",
          coalesce(sum(total_amount), 0) as "totalAmount"
        from filtered
        group by 1, 2
        order by 1
      ) item
    ),
    business_types as (
      select coalesce(jsonb_agg(to_jsonb(item) order by item."totalAmount" desc), '[]'::jsonb) as data
      from (
        select
          coalesce(business_type_id, 0) as "businessTypeId",
          coalesce(business_type_name, 'Chưa phân loại') as "businessTypeName",
          coalesce(category_name, 'Chưa phân loại') as "categoryName",
          count(*)::bigint as "paymentCount",
          coalesce(sum(total_amount), 0) as "totalAmount"
        from filtered
        group by business_type_id, business_type_name, category_name
      ) item
    ),
    methods as (
      select coalesce(jsonb_agg(to_jsonb(item) order by item."totalAmount" desc), '[]'::jsonb) as data
      from (
        select
          coalesce(payment_method, 'unknown') as "paymentMethod",
          count(*)::bigint as "paymentCount",
          coalesce(sum(total_amount), 0) as "totalAmount"
        from filtered
        group by payment_method
      ) item
    ),
    counted as (
      select count(*)::bigint as total_rows from filtered
    ),
    paged as (
      select *,
        row_number() over (order by
          case when p_sort_by = 'amount' and sort_direction = 'asc' then total_amount end asc nulls last,
          case when p_sort_by = 'amount' and sort_direction = 'desc' then total_amount end desc nulls last,
          case when p_sort_by = 'customer' and sort_direction = 'asc' then customer_name end asc nulls last,
          case when p_sort_by = 'customer' and sort_direction = 'desc' then customer_name end desc nulls last,
          case when p_sort_by = 'kiosk' and sort_direction = 'asc' then kiosk_name end asc nulls last,
          case when p_sort_by = 'kiosk' and sort_direction = 'desc' then kiosk_name end desc nulls last,
          case when coalesce(p_sort_by, 'confirmed_at') = 'confirmed_at' and sort_direction = 'asc' then confirmed_at end asc nulls last,
          confirmed_at desc nulls last,
          id desc
        ) as result_order
      from filtered
      order by
        case when p_sort_by = 'amount' and sort_direction = 'asc' then total_amount end asc nulls last,
        case when p_sort_by = 'amount' and sort_direction = 'desc' then total_amount end desc nulls last,
        case when p_sort_by = 'customer' and sort_direction = 'asc' then customer_name end asc nulls last,
        case when p_sort_by = 'customer' and sort_direction = 'desc' then customer_name end desc nulls last,
        case when p_sort_by = 'kiosk' and sort_direction = 'asc' then kiosk_name end asc nulls last,
        case when p_sort_by = 'kiosk' and sort_direction = 'desc' then kiosk_name end desc nulls last,
        case when coalesce(p_sort_by, 'confirmed_at') = 'confirmed_at' and sort_direction = 'asc' then confirmed_at end asc nulls last,
        confirmed_at desc nulls last,
        id desc
      limit p_page_size offset row_offset
    ),
    rows as (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'id', id,
          'customerId', customer_id,
          'customerName', coalesce(customer_name, 'Không tên'),
          'kioskId', kiosk_id,
          'kioskName', coalesce(kiosk_name, 'Không tên'),
          'categoryName', coalesce(category_name, 'Chưa phân loại'),
          'businessTypeName', coalesce(business_type_name, 'Chưa phân loại'),
          'confirmedAt', confirmed_at,
          'paymentMethod', coalesce(payment_method, 'unknown'),
          'totalAmount', coalesce(total_amount, 0)
        )
        order by result_order
      ), '[]'::jsonb) as data
      from paged
    )
    select jsonb_build_object(
      'tab', report_type,
      'generatedAt', now(),
      'summary', jsonb_build_object(
        'totalRevenue', coalesce(s.total_revenue, 0),
        'completedCount', coalesce(s.completed_count, 0),
        'averagePayment', coalesce(s.average_payment, 0),
        'highestPayment', coalesce(s.highest_payment, 0),
        'lowestPayment', coalesce(s.lowest_payment, 0)
      ),
      'groups', jsonb_build_object(
        'monthly', m.data,
        'businessTypes', bt.data,
        'paymentMethods', pm.data
      ),
      'rows', r.data,
      'pagination', jsonb_build_object(
        'page', p_page,
        'pageSize', p_page_size,
        'totalRows', c.total_rows,
        'totalPages', case when c.total_rows = 0 then 0 else ceil(c.total_rows::numeric / p_page_size)::integer end
      )
    )
    into result
    from summary s
    cross join monthly m
    cross join business_types bt
    cross join methods pm
    cross join counted c
    cross join rows r;

  elsif report_type = 'kiosks' then
    with
    filtered as (
      select
        k.id,
        k.customer_id,
        k.facebook_name,
        k.facebook_id,
        k.start_date,
        k.end_date,
        public.resolve_kiosk_status(k.status, k.end_date, warning_days, today_date) as status,
        coalesce(k.total_paid, 0) as total_paid,
        c.facebook_name as customer_name,
        c.phone,
        ca.name as category_name,
        bt.name as business_type_name,
        case
          when public.resolve_kiosk_status(k.status, k.end_date, warning_days, today_date) = 'warning' then true
          else false
        end as expiring_soon,
        k.end_date - today_date as days_left
      from public.registered_kiosks k
      left join public.customers c on c.id = k.customer_id
      left join public.categories ca on ca.id = k.category_id
      left join public.business_types bt on bt.id = k.business_type_id
      where (p_customer_id is null or k.customer_id = p_customer_id)
        and (p_kiosk_id is null or k.id = p_kiosk_id)
        and (p_category_id is null or k.category_id = p_category_id)
        and (p_business_type_id is null or k.business_type_id = p_business_type_id)
        and (
          p_kiosk_status is null
          or (lower(p_kiosk_status) = 'expiring_soon'
            and public.resolve_kiosk_status(k.status, k.end_date, warning_days, today_date) = 'warning')
          or public.resolve_kiosk_status(k.status, k.end_date, warning_days, today_date) = case when lower(p_kiosk_status) = 'expiring_soon' then 'warning' else lower(p_kiosk_status) end
        )
    ),
    summary as (
      select
        count(*)::bigint as total_kiosks,
        count(*) filter (where status = 'active')::bigint as active_kiosks,
        count(*) filter (where status = 'pending')::bigint as pending_kiosks,
        count(*) filter (where status = 'expired')::bigint as expired_kiosks,
        count(*) filter (where status = 'suspended')::bigint as suspended_kiosks,
        count(*) filter (where expiring_soon)::bigint as expiring_soon
      from filtered
    ),
    statuses as (
      select coalesce(jsonb_agg(to_jsonb(item) order by item."kioskCount" desc), '[]'::jsonb) as data
      from (
        select
          case when expiring_soon then 'warning' else status end as status,
          count(*)::bigint as "kioskCount",
          coalesce(sum(total_paid), 0) as "totalPaid"
        from filtered
        group by case when expiring_soon then 'warning' else status end
      ) item
    ),
    counted as (
      select count(*)::bigint as total_rows from filtered
    ),
    paged as (
      select *,
        row_number() over (order by
          case when p_sort_by = 'name' and sort_direction = 'asc' then facebook_name end asc nulls last,
          case when p_sort_by = 'name' and sort_direction = 'desc' then facebook_name end desc nulls last,
          case when p_sort_by = 'status' and sort_direction = 'asc' then status end asc nulls last,
          case when p_sort_by = 'status' and sort_direction = 'desc' then status end desc nulls last,
          case when coalesce(p_sort_by, 'end_date') = 'end_date' and sort_direction = 'asc' then end_date end asc nulls last,
          end_date desc nulls last,
          id desc
        ) as result_order
      from filtered
      order by
        case when p_sort_by = 'name' and sort_direction = 'asc' then facebook_name end asc nulls last,
        case when p_sort_by = 'name' and sort_direction = 'desc' then facebook_name end desc nulls last,
        case when p_sort_by = 'status' and sort_direction = 'asc' then status end asc nulls last,
        case when p_sort_by = 'status' and sort_direction = 'desc' then status end desc nulls last,
        case when coalesce(p_sort_by, 'end_date') = 'end_date' and sort_direction = 'asc' then end_date end asc nulls last,
        end_date desc nulls last,
        id desc
      limit p_page_size offset row_offset
    ),
    rows as (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'id', id,
          'facebookName', coalesce(facebook_name, 'Không tên'),
          'facebookId', coalesce(facebook_id, ''),
          'customerId', customer_id,
          'customerName', coalesce(customer_name, ''),
          'phone', coalesce(phone, ''),
          'categoryName', coalesce(category_name, 'Chưa phân loại'),
          'businessTypeName', coalesce(business_type_name, 'Chưa phân loại'),
          'status', status,
          'derivedStatus', case when expiring_soon then 'warning' else status end,
          'startDate', start_date,
          'endDate', end_date,
          'daysLeft', days_left,
          'totalPaid', total_paid
        )
        order by result_order
      ), '[]'::jsonb) as data
      from paged
    )
    select jsonb_build_object(
      'tab', report_type,
      'generatedAt', now(),
      'summary', jsonb_build_object(
        'totalKiosks', coalesce(s.total_kiosks, 0),
        'activeKiosks', coalesce(s.active_kiosks, 0),
        'pendingKiosks', coalesce(s.pending_kiosks, 0),
        'expiredKiosks', coalesce(s.expired_kiosks, 0),
        'suspendedKiosks', coalesce(s.suspended_kiosks, 0),
        'expiringSoon', coalesce(s.expiring_soon, 0)
      ),
      'groups', jsonb_build_object('kioskStatuses', st.data),
      'rows', r.data,
      'pagination', jsonb_build_object(
        'page', p_page,
        'pageSize', p_page_size,
        'totalRows', c.total_rows,
        'totalPages', case when c.total_rows = 0 then 0 else ceil(c.total_rows::numeric / p_page_size)::integer end
      )
    )
    into result
    from summary s
    cross join statuses st
    cross join counted c
    cross join rows r;

  elsif report_type = 'customers' then
    with
    filtered as (
      select
        c.id,
        c.facebook_name,
        c.phone,
        c.status,
        coalesce(ka.total_kiosks, 0) as total_kiosks,
        coalesce(ka.active_kiosks, 0) as active_kiosks,
        coalesce(ka.expired_kiosks, 0) as expired_kiosks, public.resolve_customer_status(c.status, coalesce(ka.kiosk_statuses, '{}'::text[])) as derived_status,
        coalesce(pa.total_paid, 0) as total_paid,
        pa.latest_completed_payment,
        ka.latest_kiosk_end_date
      from public.customers c
      left join lateral (
        select
          count(*)::bigint as total_kiosks,
          count(*) filter (where public.resolve_kiosk_status(k.status, k.end_date, warning_days, today_date) = 'active')::bigint as active_kiosks,
          count(*) filter (where public.resolve_kiosk_status(k.status, k.end_date, warning_days, today_date) = 'expired')::bigint as expired_kiosks, array_agg(public.resolve_kiosk_status(k.status, k.end_date, warning_days, today_date)) filter (where k.id is not null) as kiosk_statuses, max(k.end_date) as latest_kiosk_end_date
        from public.registered_kiosks k
        where k.customer_id = c.id
          and (p_kiosk_id is null or k.id = p_kiosk_id)
          and (p_category_id is null or k.category_id = p_category_id)
          and (p_business_type_id is null or k.business_type_id = p_business_type_id)
          and (
            p_kiosk_status is null
            or (lower(p_kiosk_status) = 'expiring_soon'
              and public.resolve_kiosk_status(k.status, k.end_date, warning_days, today_date) = 'warning')
            or public.resolve_kiosk_status(k.status, k.end_date, warning_days, today_date) = case when lower(p_kiosk_status) = 'expiring_soon' then 'warning' else lower(p_kiosk_status) end
          )
      ) ka on true
      left join lateral (
        select
          coalesce(sum(p.total_amount), 0) as total_paid,
          max(p.confirmed_at) as latest_completed_payment
        from public.payment_business_dates p
        left join public.registered_kiosks pk on pk.id = p.kiosk_id
        where p.customer_id = c.id
          and lower(p.payment_status) = 'completed'
          and p.confirmed_at is not null
          and (start_at is null or p.confirmed_at >= start_at)
          and (end_at is null or p.confirmed_at < end_at)
          and (p_kiosk_id is null or p.kiosk_id = p_kiosk_id)
          and (p_category_id is null or pk.category_id = p_category_id)
          and (p_business_type_id is null or pk.business_type_id = p_business_type_id)
          and (p_payment_status is null or lower(p.payment_status) = lower(p_payment_status))
      ) pa on true
      where (p_customer_id is null or c.id = p_customer_id)
        and (
          (p_kiosk_id is null and p_category_id is null and p_business_type_id is null and p_kiosk_status is null)
          or coalesce(ka.total_kiosks, 0) > 0
        )
    ),
    summary as (
      select
        count(*)::bigint as total_customers,
        coalesce(sum(total_kiosks), 0) as total_kiosks,
        coalesce(sum(active_kiosks), 0) as active_kiosks,
        coalesce(sum(expired_kiosks), 0) as expired_kiosks,
        coalesce(sum(total_paid), 0) as total_paid
      from filtered
    ),
    counted as (
      select count(*)::bigint as total_rows from filtered
    ),
    paged as (
      select *,
        row_number() over (order by
          case when p_sort_by = 'name' and sort_direction = 'asc' then facebook_name end asc nulls last,
          case when p_sort_by = 'name' and sort_direction = 'desc' then facebook_name end desc nulls last,
          case when p_sort_by = 'total_kiosks' and sort_direction = 'asc' then total_kiosks end asc,
          case when p_sort_by = 'total_kiosks' and sort_direction = 'desc' then total_kiosks end desc,
          case when coalesce(p_sort_by, 'total_paid') = 'total_paid' and sort_direction = 'asc' then total_paid end asc,
          total_paid desc,
          id desc
        ) as result_order
      from filtered
      order by
        case when p_sort_by = 'name' and sort_direction = 'asc' then facebook_name end asc nulls last,
        case when p_sort_by = 'name' and sort_direction = 'desc' then facebook_name end desc nulls last,
        case when p_sort_by = 'total_kiosks' and sort_direction = 'asc' then total_kiosks end asc,
        case when p_sort_by = 'total_kiosks' and sort_direction = 'desc' then total_kiosks end desc,
        case when coalesce(p_sort_by, 'total_paid') = 'total_paid' and sort_direction = 'asc' then total_paid end asc,
        total_paid desc,
        id desc
      limit p_page_size offset row_offset
    ),
    rows as (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'id', id,
          'customerName', coalesce(facebook_name, 'Không tên'),
          'phone', coalesce(phone, ''),
          'status', derived_status, 'storedStatus', lower(coalesce(status, 'unknown')),
          'totalKiosks', total_kiosks,
          'activeKiosks', active_kiosks,
          'expiredKiosks', expired_kiosks,
          'totalPaid', total_paid,
          'latestCompletedPayment', latest_completed_payment,
          'latestKioskEndDate', latest_kiosk_end_date
        )
        order by result_order
      ), '[]'::jsonb) as data
      from paged
    )
    select jsonb_build_object(
      'tab', report_type,
      'generatedAt', now(),
      'summary', jsonb_build_object(
        'totalCustomers', coalesce(s.total_customers, 0),
        'totalKiosks', coalesce(s.total_kiosks, 0),
        'activeKiosks', coalesce(s.active_kiosks, 0),
        'expiredKiosks', coalesce(s.expired_kiosks, 0),
        'totalPaid', coalesce(s.total_paid, 0)
      ),
      'rows', r.data,
      'pagination', jsonb_build_object(
        'page', p_page,
        'pageSize', p_page_size,
        'totalRows', c.total_rows,
        'totalPages', case when c.total_rows = 0 then 0 else ceil(c.total_rows::numeric / p_page_size)::integer end
      )
    )
    into result
    from summary s
    cross join counted c
    cross join rows r;

  elsif report_type = 'reconciliation' then
    with
    actual_customer_totals as (
      select
        c.id,
        count(k.id)::bigint as actual_kiosks,
        coalesce((
          select sum(p.total_amount)
          from public.payment_business_dates p
          where p.customer_id = c.id
            and lower(p.payment_status) = 'completed'
            and p.confirmed_at is not null
        ), 0) as actual_paid
      from public.customers c
      left join public.registered_kiosks k on k.customer_id = c.id
      group by c.id
    ),
    duplicate_kiosk_ids as (
      select trim(facebook_id) as facebook_id
      from public.registered_kiosks
      where nullif(trim(facebook_id), '') is not null
      group by trim(facebook_id)
      having count(*) > 1
    ),
    duplicate_requests as (
      select trim(facebook_id) as facebook_id
      from public.registration_requests
      where lower(status) = 'pending'
        and nullif(trim(facebook_id), '') is not null
      group by trim(facebook_id)
      having count(*) > 1
    ),
    issues as (
      select
        'completed_without_confirmed_at'::text as issue_code,
        'Thanh toán hoàn thành thiếu confirmed_at'::text as issue,
        'payment'::text as entity_type,
        p.id::text as record_id,
        p.id as payment_id,
        p.customer_id,
        p.kiosk_id,
        coalesce(c.facebook_name, 'Không tên') as customer_name,
        coalesce(k.facebook_name, 'Không tên') as kiosk_name,
        lower(coalesce(p.payment_status, 'unknown')) as status,
        coalesce(p.total_amount, 0) as total_amount,
        coalesce(p.confirmed_at, p.created_at) as event_at
      from public.payment_business_dates p
      left join public.customers c on c.id = p.customer_id
      left join public.registered_kiosks k on k.id = p.kiosk_id
      where lower(p.payment_status) = 'completed' and p.confirmed_at is null

      union all
      select 'payment_without_customer', 'Thanh toán thiếu khách hàng', 'payment',
        p.id::text, p.id, p.customer_id, p.kiosk_id, 'Không tên',
        coalesce(k.facebook_name, 'Không tên'), lower(coalesce(p.payment_status, 'unknown')),
        coalesce(p.total_amount, 0), coalesce(p.confirmed_at, p.created_at)
      from public.payment_business_dates p
      left join public.customers c on c.id = p.customer_id
      left join public.registered_kiosks k on k.id = p.kiosk_id
      where p.customer_id is null or c.id is null

      union all
      select 'payment_without_kiosk', 'Thanh toán thiếu Kiosk', 'payment',
        p.id::text, p.id, p.customer_id, p.kiosk_id,
        coalesce(c.facebook_name, 'Không tên'), 'Không tên',
        lower(coalesce(p.payment_status, 'unknown')), coalesce(p.total_amount, 0),
        coalesce(p.confirmed_at, p.created_at)
      from public.payment_business_dates p
      left join public.customers c on c.id = p.customer_id
      left join public.registered_kiosks k on k.id = p.kiosk_id
      where p.kiosk_id is null or k.id is null

      union all
      select 'kiosk_without_customer', 'Kiosk thiếu khách hàng', 'kiosk',
        k.id::text, null::bigint, k.customer_id, k.id, 'Không tên',
        coalesce(k.facebook_name, 'Không tên'), lower(coalesce(k.status, 'unknown')),
        0::numeric, k.created_at
      from public.registered_kiosks k
      left join public.customers c on c.id = k.customer_id
      where k.customer_id is null or c.id is null

      union all
      select 'kiosk_without_facebook_id', 'Kiosk thiếu Facebook ID', 'kiosk',
        k.id::text, null::bigint, k.customer_id, k.id,
        coalesce(c.facebook_name, 'Không tên'), coalesce(k.facebook_name, 'Không tên'),
        lower(coalesce(k.status, 'unknown')), 0::numeric, k.created_at
      from public.registered_kiosks k
      left join public.customers c on c.id = k.customer_id
      where nullif(trim(k.facebook_id), '') is null

      union all
      select 'duplicate_facebook_id', 'Facebook ID Kiosk bị trùng', 'kiosk',
        k.id::text, null::bigint, k.customer_id, k.id,
        coalesce(c.facebook_name, 'Không tên'), coalesce(k.facebook_name, 'Không tên'),
        lower(coalesce(k.status, 'unknown')), 0::numeric, k.created_at
      from public.registered_kiosks k
      join duplicate_kiosk_ids d on d.facebook_id = trim(k.facebook_id)
      left join public.customers c on c.id = k.customer_id

      union all
      select 'kiosk_without_end_date', 'Kiosk thiếu end_date', 'kiosk',
        k.id::text, null::bigint, k.customer_id, k.id,
        coalesce(c.facebook_name, 'Không tên'), coalesce(k.facebook_name, 'Không tên'),
        lower(coalesce(k.status, 'unknown')), 0::numeric, k.created_at
      from public.registered_kiosks k
      left join public.customers c on c.id = k.customer_id
      where k.end_date is null

      union all
      select 'customer_total_kiosks_mismatch', 'customers.total_kiosks không khớp', 'customer',
        c.id::text, null::bigint, c.id, null::bigint,
        coalesce(c.facebook_name, 'Không tên'), 'Không tên',
        lower(coalesce(c.status, 'unknown')), 0::numeric, c.updated_at
      from public.customers c
      join actual_customer_totals a on a.id = c.id
      where coalesce(c.total_kiosks, 0) <> a.actual_kiosks

      union all
      select 'customer_total_paid_mismatch', 'customers.total_paid không khớp', 'customer',
        c.id::text, null::bigint, c.id, null::bigint,
        coalesce(c.facebook_name, 'Không tên'), 'Không tên',
        lower(coalesce(c.status, 'unknown')), coalesce(c.total_paid, 0), c.updated_at
      from public.customers c
      join actual_customer_totals a on a.id = c.id
      where coalesce(c.total_paid, 0) <> a.actual_paid

      union all
      select 'invalid_completed_payment_amount', 'Thanh toán hoàn thành có số tiền không hợp lệ', 'payment',
        p.id::text, p.id, p.customer_id, p.kiosk_id,
        coalesce(c.facebook_name, 'Không tên'), coalesce(k.facebook_name, 'Không tên'),
        lower(coalesce(p.payment_status, 'unknown')), coalesce(p.total_amount, 0),
        coalesce(p.confirmed_at, p.created_at)
      from public.payment_business_dates p
      left join public.customers c on c.id = p.customer_id
      left join public.registered_kiosks k on k.id = p.kiosk_id
      where lower(p.payment_status) = 'completed'
        and (
          p.total_amount is null
          or (
            coalesce(to_jsonb(p)->>'transaction_type', 'standard') = 'adjustment'
            and p.total_amount = 0
          )
          or (
            coalesce(to_jsonb(p)->>'transaction_type', 'standard') <> 'adjustment'
            and p.total_amount <= 0
          )
        )

      union all
      select 'duplicated_pending_request', 'Yêu cầu chờ duyệt trùng Facebook ID', 'registration_request',
        r.id::text, null::bigint, r.customer_id, r.kiosk_id,
        coalesce(r.facebook_name, 'Không tên'), coalesce(r.facebook_name, 'Không tên'),
        lower(coalesce(r.status, 'unknown')), coalesce(r.total_amount, 0), r.submitted_at
      from public.registration_requests r
      join duplicate_requests d on d.facebook_id = trim(r.facebook_id)
      where lower(r.status) = 'pending'
    ),
    filtered as (
      select *
      from issues i
      where (p_customer_id is null or i.customer_id = p_customer_id)
        and (p_kiosk_id is null or i.kiosk_id = p_kiosk_id)
        and (
          p_category_id is null
          or exists (
            select 1 from public.registered_kiosks fk
            where fk.id = i.kiosk_id and fk.category_id = p_category_id
          )
        )
        and (
          p_business_type_id is null
          or exists (
            select 1 from public.registered_kiosks fk
            where fk.id = i.kiosk_id and fk.business_type_id = p_business_type_id
          )
        )
        and (p_payment_status is null or i.status = lower(p_payment_status))
        and (
          p_kiosk_status is null
          or exists (
            select 1
            from public.registered_kiosks fk
            where fk.id = i.kiosk_id
              and (
                (lower(p_kiosk_status) = 'expiring_soon'
                  and public.resolve_kiosk_status(fk.status, fk.end_date, warning_days, today_date) = 'warning')
                or public.resolve_kiosk_status(fk.status, fk.end_date, warning_days, today_date) = case when lower(p_kiosk_status) = 'expiring_soon' then 'warning' else lower(p_kiosk_status) end
              )
          )
        )
        and (start_at is null or i.event_at >= start_at)
        and (end_at is null or i.event_at < end_at)
    ),
    counted as (
      select count(*)::bigint as total_rows from filtered
    ),
    issue_groups as (
      select coalesce(jsonb_object_agg(issue_code, issue_count), '{}'::jsonb) as data
      from (
        select issue_code, count(*)::bigint as issue_count
        from filtered
        group by issue_code
      ) grouped
    ),
    paged as (
      select *,
        row_number() over (order by
          case when p_sort_by = 'issue' and sort_direction = 'asc' then issue end asc,
          case when p_sort_by = 'issue' and sort_direction = 'desc' then issue end desc,
          case when coalesce(p_sort_by, 'event_at') = 'event_at' and sort_direction = 'asc' then event_at end asc nulls last,
          event_at desc nulls last,
          record_id desc
        ) as result_order
      from filtered
      order by
        case when p_sort_by = 'issue' and sort_direction = 'asc' then issue end asc,
        case when p_sort_by = 'issue' and sort_direction = 'desc' then issue end desc,
        case when coalesce(p_sort_by, 'event_at') = 'event_at' and sort_direction = 'asc' then event_at end asc nulls last,
        event_at desc nulls last,
        record_id desc
      limit p_page_size offset row_offset
    ),
    rows as (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'issueCode', issue_code,
          'issue', issue,
          'issueLevel', 'warning',
          'entityType', entity_type,
          'recordId', record_id,
          'paymentId', payment_id,
          'customerId', customer_id,
          'kioskId', kiosk_id,
          'customerName', customer_name,
          'kioskName', kiosk_name,
          'status', status,
          'totalAmount', total_amount,
          'eventAt', event_at
        )
        order by result_order
      ), '[]'::jsonb) as data
      from paged
    )
    select jsonb_build_object(
      'tab', report_type,
      'generatedAt', now(),
      'summary', jsonb_build_object(
        'issueCount', c.total_rows,
        'issuesByType', ig.data
      ),
      'rows', r.data,
      'pagination', jsonb_build_object(
        'page', p_page,
        'pageSize', p_page_size,
        'totalRows', c.total_rows,
        'totalPages', case when c.total_rows = 0 then 0 else ceil(c.total_rows::numeric / p_page_size)::integer end
      )
    )
    into result
    from counted c
    cross join issue_groups ig
    cross join rows r;

  else
    with
    filtered as (
      select
        ca.id as category_id,
        ca.name as category_name,
        bt.id as business_type_id,
        bt.name as business_type_name,
        bt.price_per_month,
        count(distinct k.id)::bigint as kiosk_count,
        count(distinct k.id) filter (where public.resolve_kiosk_status(k.status, k.end_date, warning_days, today_date) = 'active')::bigint as active_kiosks,
        count(distinct k.id) filter (where public.resolve_kiosk_status(k.status, k.end_date, warning_days, today_date) = 'pending')::bigint as pending_kiosks,
        count(distinct k.id) filter (where public.resolve_kiosk_status(k.status, k.end_date, warning_days, today_date) = 'expired')::bigint as expired_kiosks,
        coalesce(sum(p.total_amount), 0) as total_revenue,
        count(distinct p.id)::bigint as completed_payments
      from public.categories ca
      left join public.business_types bt on bt.category_id = ca.id
      left join public.registered_kiosks k
        on k.business_type_id = bt.id
        and (p_customer_id is null or k.customer_id = p_customer_id)
        and (p_kiosk_id is null or k.id = p_kiosk_id)
        and (
          p_kiosk_status is null
          or (lower(p_kiosk_status) = 'expiring_soon'
            and public.resolve_kiosk_status(k.status, k.end_date, warning_days, today_date) = 'warning')
          or public.resolve_kiosk_status(k.status, k.end_date, warning_days, today_date) = case when lower(p_kiosk_status) = 'expiring_soon' then 'warning' else lower(p_kiosk_status) end
        )
      left join public.payment_business_dates p
        on p.kiosk_id = k.id
        and lower(p.payment_status) = 'completed'
        and p.confirmed_at is not null
        and (start_at is null or p.confirmed_at >= start_at)
        and (end_at is null or p.confirmed_at < end_at)
        and (p_payment_status is null or lower(p.payment_status) = lower(p_payment_status))
      where (p_category_id is null or ca.id = p_category_id)
        and (p_business_type_id is null or bt.id = p_business_type_id)
      group by ca.id, ca.name, bt.id, bt.name, bt.price_per_month
    ),
    summary as (
      select
        count(distinct category_id)::bigint as total_categories,
        count(business_type_id)::bigint as total_business_types,
        coalesce(sum(kiosk_count), 0) as total_kiosks,
        coalesce(sum(total_revenue), 0) as total_revenue,
        coalesce(sum(completed_payments), 0) as completed_payments
      from filtered
    ),
    counted as (
      select count(*)::bigint as total_rows from filtered
    ),
    paged as (
      select *,
        row_number() over (order by
          case when p_sort_by = 'name' and sort_direction = 'asc' then business_type_name end asc nulls last,
          case when p_sort_by = 'name' and sort_direction = 'desc' then business_type_name end desc nulls last,
          case when p_sort_by = 'kiosks' and sort_direction = 'asc' then kiosk_count end asc,
          case when p_sort_by = 'kiosks' and sort_direction = 'desc' then kiosk_count end desc,
          case when coalesce(p_sort_by, 'revenue') = 'revenue' and sort_direction = 'asc' then total_revenue end asc,
          total_revenue desc,
          business_type_id
        ) as result_order
      from filtered
      order by
        case when p_sort_by = 'name' and sort_direction = 'asc' then business_type_name end asc nulls last,
        case when p_sort_by = 'name' and sort_direction = 'desc' then business_type_name end desc nulls last,
        case when p_sort_by = 'kiosks' and sort_direction = 'asc' then kiosk_count end asc,
        case when p_sort_by = 'kiosks' and sort_direction = 'desc' then kiosk_count end desc,
        case when coalesce(p_sort_by, 'revenue') = 'revenue' and sort_direction = 'asc' then total_revenue end asc,
        total_revenue desc,
        business_type_id
      limit p_page_size offset row_offset
    ),
    rows as (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'categoryId', category_id,
          'categoryName', coalesce(category_name, 'Chưa phân loại'),
          'businessTypeId', business_type_id,
          'businessTypeName', coalesce(business_type_name, 'Chưa phân loại'),
          'pricePerMonth', coalesce(price_per_month, 0),
          'kioskCount', kiosk_count,
          'activeKiosks', active_kiosks,
          'pendingKiosks', pending_kiosks,
          'expiredKiosks', expired_kiosks,
          'completedPayments', completed_payments,
          'totalRevenue', total_revenue
        )
        order by result_order
      ), '[]'::jsonb) as data
      from paged
    )
    select jsonb_build_object(
      'tab', report_type,
      'generatedAt', now(),
      'summary', jsonb_build_object(
        'totalCategories', coalesce(s.total_categories, 0),
        'totalBusinessTypes', coalesce(s.total_business_types, 0),
        'totalKiosks', coalesce(s.total_kiosks, 0),
        'totalRevenue', coalesce(s.total_revenue, 0),
        'completedCount', coalesce(s.completed_payments, 0)
      ),
      'rows', r.data,
      'pagination', jsonb_build_object(
        'page', p_page,
        'pageSize', p_page_size,
        'totalRows', c.total_rows,
        'totalPages', case when c.total_rows = 0 then 0 else ceil(c.total_rows::numeric / p_page_size)::integer end
      )
    )
    into result
    from summary s
    cross join counted c
    cross join rows r;
  end if;

  result := coalesce(result, jsonb_build_object(
    'tab', report_type,
    'summary', '{}'::jsonb,
    'rows', '[]'::jsonb,
    'pagination', jsonb_build_object(
      'page', p_page, 'pageSize', p_page_size, 'totalRows', 0, 'totalPages', 0
    )
  ));
  return result || jsonb_build_object(
    'warningDays', warning_days,
    'reportDate', today_date
  );
end;
$function$;
CREATE OR REPLACE FUNCTION public.get_kiosk_status_data(p_search text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_business_type_id bigint DEFAULT NULL::bigint, p_sort_by text DEFAULT 'created_at'::text, p_sort_direction text DEFAULT 'desc'::text, p_page integer DEFAULT 1, p_page_size integer DEFAULT 12)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  warning_days integer;
  today_date date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  result jsonb;
begin
  if p_page < 1 or p_page_size not in (12, 24, 48) then
    raise exception 'Phân trang Kiosk không hợp lệ.';
  end if;
  if lower(coalesce(p_sort_direction, 'desc')) not in ('asc', 'desc') then
    raise exception 'Chiều sắp xếp không hợp lệ.';
  end if;

  warning_days := public.get_status_warning_days();

  with classified as (
    select k.*,
      public.resolve_kiosk_status(k.status, k.end_date, warning_days, today_date) as derived_status,
      c.facebook_name as customer_name, c.facebook_id as customer_facebook_id,
      c.phone as customer_phone, c.address as customer_address, c.status as customer_stored_status,
      c.total_paid as customer_total_paid, c.total_kiosks as customer_total_kiosks, c.note as customer_note,
      ca.name as category_name, bt.name as business_type_name, bt.price_per_month
    from public.registered_kiosks k
    left join public.customers c on c.id = k.customer_id
    left join public.categories ca on ca.id = k.category_id
    left join public.business_types bt on bt.id = k.business_type_id
  ), filtered as (
    select * from classified
    where (p_business_type_id is null or business_type_id = p_business_type_id)
      and (p_status is null or p_status = '' or derived_status = lower(p_status))
      and (p_search is null or btrim(p_search) = '' or
        facebook_name ilike '%' || btrim(p_search) || '%' or
        facebook_id ilike '%' || btrim(p_search) || '%' or
        derived_status ilike '%' || btrim(p_search) || '%' or
        business_type_name ilike '%' || btrim(p_search) || '%')
  ), counted as (
    select count(*)::bigint as total_rows from filtered
  ), groups as (
    select coalesce(jsonb_object_agg(derived_status, amount), '{}'::jsonb) as data
    from (select derived_status, count(*)::bigint amount from filtered group by derived_status) grouped
  ), paged as (
    select * from filtered
    order by
      case when p_sort_by = 'end_date' and lower(p_sort_direction) = 'asc' then end_date end asc nulls last,
      case when p_sort_by = 'end_date' and lower(p_sort_direction) = 'desc' then end_date end desc nulls last,
      case when p_sort_by = 'facebook_name' and lower(p_sort_direction) = 'asc' then facebook_name end asc nulls last,
      case when p_sort_by = 'facebook_name' and lower(p_sort_direction) = 'desc' then facebook_name end desc nulls last,
      case when p_sort_by = 'status' and lower(p_sort_direction) = 'asc' then derived_status end asc,
      case when p_sort_by = 'status' and lower(p_sort_direction) = 'desc' then derived_status end desc,
      case when coalesce(p_sort_by, 'created_at') = 'created_at' and lower(p_sort_direction) = 'asc' then created_at end asc,
      created_at desc, id desc
    limit p_page_size offset (p_page - 1) * p_page_size
  ), rows as (
    select coalesce(jsonb_agg(to_jsonb(paged)
      - 'derived_status' - 'customer_name' - 'customer_facebook_id' - 'customer_phone'
      - 'customer_address' - 'customer_stored_status' - 'customer_total_paid'
      - 'customer_total_kiosks' - 'customer_note' - 'category_name'
      - 'business_type_name' - 'price_per_month'
      || jsonb_build_object('status', derived_status, 'stored_status', status,
      'customers', jsonb_build_object('id', customer_id, 'facebook_name', customer_name,
        'facebook_id', customer_facebook_id, 'phone', customer_phone, 'address', customer_address,
        'status', customer_stored_status, 'total_paid', customer_total_paid,
        'total_kiosks', customer_total_kiosks, 'note', customer_note),
      'categories', jsonb_build_object('name', category_name),
      'business_types', jsonb_build_object('name', business_type_name, 'price_per_month', price_per_month)
    ) order by case when p_status = 'warning' then end_date end asc nulls last, id desc), '[]'::jsonb) as data
    from paged
  )
  select jsonb_build_object('rows', r.data, 'totalRows', c.total_rows,
    'statusCounts', g.data, 'warningDays', warning_days, 'reportDate', today_date)
  into result from rows r cross join counted c cross join groups g;
  return coalesce(result, '{}'::jsonb);
end
$function$;
CREATE OR REPLACE FUNCTION public.get_customer_status_data(p_search text DEFAULT NULL::text, p_customer_status text DEFAULT NULL::text, p_kiosk_status text DEFAULT NULL::text, p_customer_id bigint DEFAULT NULL::bigint, p_sort_by text DEFAULT 'created_at'::text, p_sort_direction text DEFAULT 'desc'::text, p_page integer DEFAULT 1, p_page_size integer DEFAULT 10)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  warning_days integer;
  today_date date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  result jsonb;
begin
  if p_page < 1 or p_page_size not in (10, 25, 50) then raise exception 'Phân trang khách hàng không hợp lệ.'; end if;
  warning_days := public.get_status_warning_days();

  with kiosk_states as (
    select k.customer_id, k.id,
      public.resolve_kiosk_status(k.status, k.end_date, warning_days, today_date) as derived_status,
      k.end_date
    from public.registered_kiosks k
  ), classified as (
    select c.*,
      public.resolve_customer_status(c.status,
        coalesce(array_agg(ks.derived_status) filter (where ks.id is not null), '{}'::text[])) as derived_status,
      coalesce(count(ks.id), 0)::bigint as actual_total_kiosks,
      min(ks.end_date) filter (where ks.derived_status = 'warning') as nearest_warning_end_date,
      max(ks.end_date) filter (where ks.derived_status = 'expired') as latest_expired_end_date,
      coalesce(bool_or(ks.derived_status = lower(p_kiosk_status)), false) as has_requested_kiosk_status
    from public.customers c left join kiosk_states ks on ks.customer_id = c.id
    group by c.id
  ), filtered as (
    select * from classified
    where (p_customer_id is null or id = p_customer_id)
      and (p_customer_status is null or p_customer_status = '' or derived_status = lower(p_customer_status))
      and (p_kiosk_status is null or p_kiosk_status = '' or has_requested_kiosk_status)
      and (p_search is null or btrim(p_search) = '' or phone ilike '%' || btrim(p_search) || '%'
        or facebook_id ilike '%' || btrim(p_search) || '%' or facebook_name ilike '%' || btrim(p_search) || '%')
  ), counted as (select count(*)::bigint total_rows from filtered),
  groups as (
    select coalesce(jsonb_object_agg(derived_status, amount), '{}'::jsonb) data
    from (select derived_status, count(*)::bigint amount from filtered group by derived_status) grouped
  ), paged as (
    select * from filtered order by
      case when p_kiosk_status = 'warning' then nearest_warning_end_date end asc nulls last,
      case when p_kiosk_status = 'expired' then latest_expired_end_date end desc nulls last,
      case when p_sort_by = 'facebook_name' and lower(p_sort_direction) = 'asc' then facebook_name end asc,
      case when p_sort_by = 'facebook_name' and lower(p_sort_direction) = 'desc' then facebook_name end desc,
      case when p_sort_by = 'total_kiosks' and lower(p_sort_direction) = 'asc' then actual_total_kiosks end asc,
      case when p_sort_by = 'total_kiosks' and lower(p_sort_direction) = 'desc' then actual_total_kiosks end desc,
      case when coalesce(p_sort_by, 'created_at') = 'created_at' and lower(p_sort_direction) = 'asc' then created_at end asc,
      created_at desc, id desc
    limit p_page_size offset (p_page - 1) * p_page_size
  ), rows as (
    select coalesce(jsonb_agg(to_jsonb(paged) - 'has_requested_kiosk_status'
      || jsonb_build_object('stored_status', status, 'status', derived_status,
        'total_kiosks', actual_total_kiosks)), '[]'::jsonb) data from paged
  )
  select jsonb_build_object('rows', r.data, 'totalRows', c.total_rows,
    'statusCounts', g.data, 'warningDays', warning_days, 'reportDate', today_date)
  into result from rows r cross join counted c cross join groups g;
  return coalesce(result, '{}'::jsonb);
end
$function$;
CREATE OR REPLACE FUNCTION public.get_business_types_with_stats(search_term text)
 RETURNS TABLE(id bigint, category_id bigint, name text, description text, price_per_month numeric, is_active boolean, created_at timestamp with time zone, updated_at timestamp with time zone, category_name text, kiosk_count bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select
    bt.id,
    bt.category_id,
    bt.name,
    bt.description,
    bt.price_per_month,
    bt.is_active,
    bt.created_at,
    bt.updated_at,
    c.name as category_name,
    coalesce(k.kiosk_count, 0) as kiosk_count
  from public.business_types bt
  left join public.categories c on bt.category_id = c.id
  left join (
    select business_type_id, count(*) as kiosk_count
    from public.registered_kiosks
    where business_type_id is not null
    group by business_type_id
  ) k on bt.id = k.business_type_id
  where search_term is null
     or bt.name ilike ('%' || search_term || '%')
     or bt.description ilike ('%' || search_term || '%')
     or c.name ilike ('%' || search_term || '%');
$function$;
CREATE OR REPLACE FUNCTION public.get_categories_with_stats()
 RETURNS TABLE(id bigint, name text, description text, is_active boolean, created_at timestamp with time zone, updated_at timestamp with time zone, kiosk_count bigint, customer_count bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select
    c.id,
    c.name,
    c.description,
    c.is_active,
    c.created_at,
    c.updated_at,
    coalesce(k.kiosk_count, 0) as kiosk_count,
    coalesce(k.customer_count, 0) as customer_count
  from public.categories c
  left join (
    select
      category_id,
      count(*) as kiosk_count,
      count(distinct customer_id) as customer_count
    from public.registered_kiosks
    where category_id is not null
    group by category_id
  ) k on c.id = k.category_id;
$function$;
CREATE OR REPLACE FUNCTION public.get_registration_operations_summary()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if auth.uid() is null or not exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid()
      and pg_catalog.lower(ur.role) = 'admin'
      and ur.is_active
  ) then
    raise exception 'Bạn không có quyền xem tổng hợp đăng ký.' using errcode = '42501';
  end if;
  return pg_catalog.jsonb_build_object(
    'pendingPayments', (select pg_catalog.count(*) from public.payments p where p.payment_status = 'pending'),
    'awaitingPaymentRequests', (select pg_catalog.count(*) from public.registration_requests r where r.status = 'awaiting_payment'),
    'pendingKiosks', (select pg_catalog.count(*) from public.registered_kiosks k where k.status = 'pending'),
    'pendingReviewRequests', (select pg_catalog.count(*) from public.registration_requests r where r.status = 'pending')
  );
end;
$function$;
CREATE OR REPLACE FUNCTION public.get_monthly_revenue()
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select coalesce(sum(total_amount),0)
  from public.payment_business_dates
  where payment_status = 'completed'
    and date_trunc('month',confirmed_at at time zone 'Asia/Ho_Chi_Minh')
      = date_trunc('month',now() at time zone 'Asia/Ho_Chi_Minh');
$function$;
CREATE OR REPLACE FUNCTION public.get_yearly_revenue(year_input integer)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select coalesce(sum(total_amount),0)
  from public.payment_business_dates
  where payment_status = 'completed'
    and extract(year from confirmed_at at time zone 'Asia/Ho_Chi_Minh') = year_input;
$function$;
CREATE OR REPLACE FUNCTION public.get_payment_summary(search_input text DEFAULT NULL::text, status_input text DEFAULT NULL::text, payment_method_input text DEFAULT NULL::text, business_type_id_input bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor public.user_roles%rowtype;
  month_start timestamptz := date_trunc(
    'month',
    now() at time zone 'Asia/Ho_Chi_Minh'
  ) at time zone 'Asia/Ho_Chi_Minh';
  next_month_start timestamptz;
  result jsonb;
begin
  actor := private.assert_payment_permission();
  next_month_start := ((month_start at time zone 'Asia/Ho_Chi_Minh') + interval '1 month') at time zone 'Asia/Ho_Chi_Minh';

  select jsonb_build_object(
    'totalRevenue', coalesce(sum(p.total_amount) filter (
      where lower(p.payment_status) = 'completed'
        and p.confirmed_at is not null
    ), 0),
    'monthRevenue', coalesce(sum(p.total_amount) filter (
      where lower(p.payment_status) = 'completed'
        and p.confirmed_at is not null
        and p.confirmed_at >= month_start
        and p.confirmed_at < next_month_start
    ), 0),
    'transferRevenue', coalesce(sum(p.total_amount) filter (
      where lower(p.payment_status) = 'completed'
        and p.confirmed_at is not null
        and lower(coalesce(p.payment_method, '')) in (
          'transfer', 'bank_transfer', 'chuyen_khoan', 'chuyển khoản'
        )
    ), 0),
    'pendingCount', count(*) filter (
      where lower(p.payment_status) = 'pending'
    )
  )
  into result
  from public.payment_business_dates p
  left join public.customers c on c.id = p.customer_id
  left join public.kiosks k on k.id = p.kiosk_id
  left join public.business_types bt on bt.id = k.business_type_id
  where (status_input is null or lower(p.payment_status) = lower(status_input))
    and (payment_method_input is null or lower(p.payment_method) = lower(payment_method_input))
    and (business_type_id_input is null or k.business_type_id = business_type_id_input)
    and (
      nullif(trim(search_input), '') is null
      or p.payment_status ilike '%' || trim(search_input) || '%'
      or coalesce(p.payment_method, '') ilike '%' || trim(search_input) || '%'
      or coalesce(p.discount_reason, '') ilike '%' || trim(search_input) || '%'
      or coalesce(p.note, '') ilike '%' || trim(search_input) || '%'
      or coalesce(c.facebook_name, '') ilike '%' || trim(search_input) || '%'
      or coalesce(c.facebook_id, '') ilike '%' || trim(search_input) || '%'
      or coalesce(c.phone, '') ilike '%' || trim(search_input) || '%'
      or coalesce(k.facebook_name, '') ilike '%' || trim(search_input) || '%'
      or coalesce(k.facebook_id, '') ilike '%' || trim(search_input) || '%'
      or coalesce(bt.name, '') ilike '%' || trim(search_input) || '%'
    );

  return coalesce(result, jsonb_build_object(
    'totalRevenue', 0,
    'monthRevenue', 0,
    'transferRevenue', 0,
    'pendingCount', 0
  ));
end;
$function$;
CREATE OR REPLACE FUNCTION public.get_payment_summary(search_input text, status_input text, payment_method_input text, business_type_id_input bigint, from_date_input date, to_date_input date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor public.user_roles%rowtype;
  month_start timestamptz := date_trunc(
    'month',
    now() at time zone 'Asia/Ho_Chi_Minh'
  ) at time zone 'Asia/Ho_Chi_Minh';
  next_month_start timestamptz;
  result jsonb;
begin
  actor := private.assert_payment_permission();
  next_month_start := ((month_start at time zone 'Asia/Ho_Chi_Minh') + interval '1 month') at time zone 'Asia/Ho_Chi_Minh';

  select jsonb_build_object(
    'totalRevenue', coalesce(sum(p.total_amount) filter (
      where lower(p.payment_status) = 'completed'
        and p.confirmed_at is not null
    ), 0),
    'monthRevenue', coalesce(sum(p.total_amount) filter (
      where lower(p.payment_status) = 'completed'
        and p.confirmed_at is not null
        and p.confirmed_at >= month_start
        and p.confirmed_at < next_month_start
    ), 0),
    'transferRevenue', coalesce(sum(p.total_amount) filter (
      where lower(p.payment_status) = 'completed'
        and p.confirmed_at is not null
        and lower(coalesce(p.payment_method, '')) in (
          'transfer', 'bank_transfer', 'chuyen_khoan', 'chuyển khoản'
        )
    ), 0),
    'pendingCount', count(*) filter (
      where lower(p.payment_status) = 'pending'
    )
  )
  into result
  from public.payment_business_dates p
  left join public.customers c on c.id = p.customer_id
  left join public.kiosks k on k.id = p.kiosk_id
  left join public.business_types bt on bt.id = k.business_type_id
  where (from_date_input is null or p.business_at >= (from_date_input::timestamp at time zone 'Asia/Ho_Chi_Minh'))
    and (to_date_input is null or p.business_at < ((to_date_input+1)::timestamp at time zone 'Asia/Ho_Chi_Minh'))
    and (status_input is null or lower(p.payment_status) = lower(status_input))
    and (payment_method_input is null or lower(p.payment_method) = lower(payment_method_input))
    and (business_type_id_input is null or k.business_type_id = business_type_id_input)
    and (
      nullif(trim(search_input), '') is null
      or p.payment_status ilike '%' || trim(search_input) || '%'
      or coalesce(p.payment_method, '') ilike '%' || trim(search_input) || '%'
      or coalesce(p.discount_reason, '') ilike '%' || trim(search_input) || '%'
      or coalesce(p.note, '') ilike '%' || trim(search_input) || '%'
      or coalesce(c.facebook_name, '') ilike '%' || trim(search_input) || '%'
      or coalesce(c.facebook_id, '') ilike '%' || trim(search_input) || '%'
      or coalesce(c.phone, '') ilike '%' || trim(search_input) || '%'
      or coalesce(k.facebook_name, '') ilike '%' || trim(search_input) || '%'
      or coalesce(k.facebook_id, '') ilike '%' || trim(search_input) || '%'
      or coalesce(bt.name, '') ilike '%' || trim(search_input) || '%'
    );

  return coalesce(result, jsonb_build_object(
    'totalRevenue', 0,
    'monthRevenue', 0,
    'transferRevenue', 0,
    'pendingCount', 0
  ));
end;
$function$;
revoke all on function public.get_payment_summary(text,text,text,bigint,date,date) from public, anon;
grant execute on function public.get_payment_summary(text,text,text,bigint,date,date) to authenticated;
CREATE OR REPLACE FUNCTION private.sync_completed_payment_totals()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  affected_kiosk_id bigint;
begin
  if tg_op='INSERT' and new.payment_status<>'completed' then return new; end if;
  if tg_op='UPDATE' and (not private.payment_totals_changed(old,new) or (old.payment_status<>'completed' and new.payment_status<>'completed')) then return new; end if;
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
CREATE OR REPLACE FUNCTION private.recalculate_kiosk_payment_total(kiosk_id_input bigint)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  where k.id = kiosk_id_input
    and (k.total_paid,k.kiosk_total_paid,k.last_payment_date) is distinct from (totals.amount,totals.amount,totals.paid_on);
$function$;
create or replace function private.recalculate_customer_payment_total(customer_id_input bigint) returns void language sql security definer set search_path='' as $$
with totals as (select coalesce(sum(total_amount),0) as amount,max(revenue_date) as paid_on from public.payment_business_dates where customer_id=customer_id_input and payment_status='completed' and confirmed_at is not null)
update public.customers c set total_paid=t.amount,last_payment_date=t.paid_on,updated_at=now() from totals t where c.id=customer_id_input and (c.total_paid,c.last_payment_date) is distinct from (t.amount,t.paid_on)
$$;
CREATE OR REPLACE FUNCTION public.log_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  changer_text text := coalesce(auth.uid()::text, 'Hệ thống');
begin
  if TG_OP='UPDATE' and to_jsonb(old) is not distinct from to_jsonb(new) then return new; end if;
  if (TG_OP = 'INSERT') then
    insert into public.logs (
      action,
      table_name,
      record_id,
      new_value,
      new_data,
      created_by,
      created_at
    )
    values (
      'INSERT',
      TG_TABLE_NAME,
      NEW.id,
      to_jsonb(NEW),
      to_jsonb(NEW),
      changer_text,
      now()
    );

    return NEW;

  elsif (TG_OP = 'UPDATE') then
    insert into public.logs (
      action,
      table_name,
      record_id,
      old_value,
      new_value,
      old_data,
      new_data,
      created_by,
      created_at
    )
    values (
      'UPDATE',
      TG_TABLE_NAME,
      NEW.id,
      to_jsonb(OLD),
      to_jsonb(NEW),
      to_jsonb(OLD),
      to_jsonb(NEW),
      changer_text,
      now()
    );

    return NEW;

  elsif (TG_OP = 'DELETE') then
    insert into public.logs (
      action,
      table_name,
      record_id,
      old_value,
      old_data,
      created_by,
      created_at
    )
    values (
      'DELETE',
      TG_TABLE_NAME,
      OLD.id,
      to_jsonb(OLD),
      to_jsonb(OLD),
      changer_text,
      now()
    );

    return OLD;
  end if;

  return null;
end;
$function$;
CREATE OR REPLACE FUNCTION public.get_audit_logs(actor_filter text DEFAULT NULL::text, module_filter text DEFAULT NULL::text, action_filter text DEFAULT NULL::text, from_time timestamp with time zone DEFAULT NULL::timestamp with time zone, to_time timestamp with time zone DEFAULT NULL::timestamp with time zone, search_term text DEFAULT NULL::text, show_technical boolean DEFAULT false, page_number integer DEFAULT 1, page_size integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  normalized_page integer := greatest(coalesce(page_number, 1), 1);
  normalized_size integer := case when page_size in (10, 20, 50) then page_size else 20 end;
  requested_category text := case pg_catalog.lower(nullif(pg_catalog.btrim(module_filter), ''))
    when 'kiosk' then 'kiosk'
    when 'kiosks' then 'kiosk'
    when 'registration' then 'kiosk'
    when 'registrations' then 'kiosk'
    when 'registration_request' then 'kiosk'
    when 'registration_requests' then 'kiosk'
    when 'registration_batch' then 'kiosk'
    when 'registration_batches' then 'kiosk'
    when 'public_registration' then 'kiosk'
    when 'public_registrations' then 'kiosk'
    when 'customer' then 'customer'
    when 'customers' then 'customer'
    when 'client' then 'customer'
    when 'clients' then 'customer'
    when 'payment' then 'payment'
    when 'payments' then 'payment'
    when 'transaction' then 'payment'
    when 'transactions' then 'payment'
    when 'payos' then 'payment'
    when 'payment_intent' then 'payment'
    when 'payment_intents' then 'payment'
    when 'payment_order' then 'payment'
    when 'payment_orders' then 'payment'
    when 'renewal' then 'renewal'
    when 'renewals' then 'renewal'
    when 'kiosk_renewal' then 'renewal'
    when 'kiosk_renewals' then 'renewal'
    when 'gia_han' then 'renewal'
    when 'usermanagement' then 'user'
    when 'user_management' then 'user'
    when 'user-management' then 'user'
    when 'user' then 'user'
    when 'users' then 'user'
    when 'user_profile' then 'user'
    when 'user_profiles' then 'user'
    when 'staff' then 'user'
    when 'staffs' then 'user'
    when 'staff_member' then 'user'
    when 'staff_members' then 'user'
    when 'personnel' then 'user'
    when 'employee' then 'user'
    when 'employees' then 'user'
    when 'permission' then 'user'
    when 'permissions' then 'user'
    when 'user_permission' then 'user'
    when 'user_permissions' then 'user'
    when 'wallet' then 'user'
    when 'wallets' then 'user'
    when 'ttc_wallet' then 'user'
    when 'ttc_wallets' then 'user'
    when 'ttc_user_wallet' then 'user'
    when 'ttc_user_wallets' then 'user'
    when 'promotion' then 'promotion'
    when 'promotions' then 'promotion'
    when 'discount' then 'promotion'
    when 'discounts' then 'promotion'
    when 'coupon' then 'promotion'
    when 'coupons' then 'promotion'
    when 'promotion_usage' then 'promotion'
    when 'promotion_usages' then 'promotion'
    when 'system' then 'system'
    when 'webhook' then 'system'
    when 'webhooks' then 'system'
    when 'cron' then 'system'
    when 'cleanup' then 'system'
    when 'sync' then 'system'
    when 'synchronization' then 'system'
    when 'trigger' then 'system'
    when 'database_trigger' then 'system'
    else pg_catalog.lower(nullif(pg_catalog.btrim(module_filter), ''))
  end;
  result jsonb;
begin
  perform private.assert_audit_access();

  with resolved as materialized (
    select
      al.id,
      al.legacy_log_id,
      al.actor_id,
      case
        when al.actor_id is not null then coalesce(ur.display_name, ur.username, al.actor_name, 'Nhân viên')
        when coalesce(al.actor_type, pg_catalog.lower(al.actor_role)) in ('public', 'anon') then 'Public User'
        when al.actor_type = 'database_trigger' then 'Database Trigger'
        else 'System'
      end as actor_name,
      coalesce(
        al.actor_type,
        case
          when al.actor_id is not null then 'staff'
          when pg_catalog.lower(al.actor_role) in ('public', 'anon') then 'public'
          else 'system'
        end
      ) as actor_type,
      coalesce(ur.role, al.actor_role, 'system') as actor_role,
      al.module,
      coalesce(al.entity, al.module) as entity,
      al.record_id,
      al.action,
      al.before,
      al.after,
      al.reason,
      al.created_at,
      pg_catalog.lower(pg_catalog.btrim(coalesce(al.module, ''))) as normalized_module,
      pg_catalog.lower(pg_catalog.btrim(coalesce(al.entity, ''))) as normalized_entity,
      pg_catalog.lower(pg_catalog.btrim(coalesce(al.action, ''))) as normalized_action
    from public.audit_logs al
    left join public.user_roles ur on ur.user_id = al.actor_id
  ),
  classified as materialized (
    select
      r.*,
      case
        when r.normalized_module = any (array['renewal','renewals','kiosk_renewal','kiosk_renewals','gia_han']::text[])
          or r.normalized_entity = any (array['renewal','renewals','kiosk_renewal','kiosk_renewals','gia_han']::text[])
          or r.normalized_action = 'admin_manual_renewal'
          or r.normalized_action like '%renewal%'
          then 'renewal'
        when r.normalized_module = any (array['promotion','promotions','discount','discounts','coupon','coupons','promotion_usage','promotion_usages']::text[])
          or r.normalized_entity = any (array['promotion','promotions','discount','discounts','coupon','coupons','promotion_usage','promotion_usages']::text[])
          or r.normalized_action like '%promotion%'
          then 'promotion'
        when r.normalized_module = any (array['payment','payments','transaction','transactions','payos','payment_intent','payment_intents','payment_order','payment_orders']::text[])
          or r.normalized_entity = any (array['payment','payments','transaction','transactions','payos','payment_intent','payment_intents','payment_order','payment_orders']::text[])
          or r.normalized_action like '%payos%'
          or r.normalized_action like '%payment%'
          or r.normalized_action like '%refund%'
          then 'payment'
        when r.normalized_module = any (array['usermanagement','user_management','user-management','user','users','user_profile','user_profiles','staff','staffs','staff_member','staff_members','personnel','employee','employees','permission','permissions','user_permission','user_permissions','wallet','wallets','ttc_wallet','ttc_wallets','ttc_user_wallet','ttc_user_wallets']::text[])
          or r.normalized_entity = any (array['usermanagement','user_management','user-management','user','users','user_profile','user_profiles','staff','staffs','staff_member','staff_members','personnel','employee','employees','permission','permissions','user_permission','user_permissions','wallet','wallets','ttc_wallet','ttc_wallets','ttc_user_wallet','ttc_user_wallets']::text[])
          or r.normalized_action = any (array['reset_password','update_profile','admin_reset_user_password','admin_update_user_profile','admin_update_user_status','sync_permissions','lock_user','unlock_user','adjust_wallet','admin_adjustment']::text[])
          then 'user'
        when r.normalized_module = any (array['customer','customers','client','clients']::text[])
          or r.normalized_entity = any (array['customer','customers','client','clients']::text[])
          then 'customer'
        when r.normalized_module = any (array['kiosk','kiosks','registration','registrations','registration_request','registration_requests','registration_batch','registration_batches','public_registration','public_registrations']::text[])
          or r.normalized_entity = any (array['kiosk','kiosks','registration','registrations','registration_request','registration_requests','registration_batch','registration_batches','public_registration','public_registrations']::text[])
          or r.normalized_action = any (array['review_legacy_approve','review_legacy_cancel','admin_cancel']::text[])
          then 'kiosk'
        else 'system'
      end as category
    from resolved r
  ),
  visible as materialized (
    select c.*
    from classified c
    where show_technical or private.is_business_audit(c.action,c.entity,c.legacy_log_id,c.reason,c.before,c.after)
  ),
  filtered as materialized (
    select *
    from visible r
    where (nullif(pg_catalog.btrim(actor_filter), '') is null
        or r.actor_name ilike '%' || pg_catalog.btrim(actor_filter) || '%'
        or r.actor_role ilike '%' || pg_catalog.btrim(actor_filter) || '%'
        or r.actor_type ilike '%' || pg_catalog.btrim(actor_filter) || '%'
        or r.actor_id::text = pg_catalog.btrim(actor_filter))
      and (requested_category is null
        or r.category = requested_category
        or r.normalized_module = pg_catalog.lower(pg_catalog.btrim(module_filter))
        or r.normalized_entity = pg_catalog.lower(pg_catalog.btrim(module_filter)))
      and (nullif(pg_catalog.btrim(action_filter), '') is null
        or r.normalized_action = pg_catalog.lower(pg_catalog.btrim(action_filter))
        or action_filter='business:'||private.business_activity(r.action,r.category,r.after))
      and (from_time is null or r.created_at >= from_time)
      and (to_time is null or r.created_at < to_time)
      and (nullif(pg_catalog.btrim(search_term), '') is null
        or r.module ilike '%' || pg_catalog.btrim(search_term) || '%'
        or r.entity ilike '%' || pg_catalog.btrim(search_term) || '%'
        or r.action ilike '%' || pg_catalog.btrim(search_term) || '%'
        or r.actor_name ilike '%' || pg_catalog.btrim(search_term) || '%'
        or coalesce(r.reason, '') ilike '%' || pg_catalog.btrim(search_term) || '%'
        or coalesce(r.after->>'kiosk_name',r.after->>'facebook_name','') ilike '%' || pg_catalog.btrim(search_term) || '%'
        or coalesce(r.record_id, '') ilike '%' || pg_catalog.btrim(search_term) || '%')
  ),
  stats as (
    select pg_catalog.count(*)::integer as total from filtered
  ),
  bounds as (
    select
      total,
      least(normalized_page, greatest(1, ceil(total::numeric / normalized_size)::integer)) as effective_page
    from stats
  ),
  paged as (
    select f.*
    from filtered f
    cross join bounds b
    order by f.created_at desc, f.id desc
    limit normalized_size
    offset ((select effective_page from bounds) - 1) * normalized_size
  )
  select pg_catalog.jsonb_build_object(
    'rows', coalesce(
      (
        select pg_catalog.jsonb_agg(
          pg_catalog.to_jsonb(p) - 'normalized_module' - 'normalized_entity' - 'normalized_action'
          order by p.created_at desc, p.id desc
        )
        from paged p
      ),
      '[]'::jsonb
    ),
    'total', b.total,
    'page', b.effective_page,
    'pageSize', normalized_size
  ) into result
  from bounds b;

  return result;
end;
$function$;
CREATE OR REPLACE FUNCTION private.materialize_registration_checkout_v3(request_ids_input bigint[], phone_input text, promotion_code_input text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  normalized_phone text := pg_catalog.regexp_replace(coalesce(phone_input, ''), '[^0-9+]', '', 'g');
  normalized_code text := nullif(pg_catalog.upper(pg_catalog.btrim(coalesce(promotion_code_input, ''))), '');
  request_count integer;
  request_record public.registration_requests%rowtype;
  batch_record public.registration_batches%rowtype;
  customer_record public.customers%rowtype;
  kiosk_record public.kiosks%rowtype;
  package_record public.business_types%rowtype;
  payment_record public.payments%rowtype;
  first_kiosk_id bigint;
  authoritative_total numeric := 0;
  item_total numeric;
  group_member_base_url text;
  result_items jsonb := '[]'::jsonb;
  evaluation_items jsonb := '[]'::jsonb;
  evaluation jsonb;
  batch_key text;
begin
  request_count := coalesce(pg_catalog.array_length(request_ids_input, 1), 0);
  if request_count < 1 or request_count > 20 then
    raise exception 'Lô đăng ký phải có từ 1 đến 20 Kiosk.' using errcode = '22023';
  end if;
  if normalized_phone = '' then
    raise exception 'Số điện thoại xác nhận không hợp lệ.' using errcode = '22023';
  end if;
  if (
    select pg_catalog.count(distinct value)
    from pg_catalog.unnest(request_ids_input) value
  ) <> request_count then
    raise exception 'Danh sách yêu cầu đăng ký bị trùng.' using errcode = '22023';
  end if;

  -- Serialize customer matching across different registration batches too.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('registration-phone:'||normalized_phone,0));
  batch_key := 'registration-checkout-v3:' || (
    select pg_catalog.string_agg(value::text, ',' order by value)
    from pg_catalog.unnest(request_ids_input) value
  );
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(batch_key, 0));

  perform 1
  from public.registration_requests
  where id = any(request_ids_input)
  order by id
  for update;

  select pg_catalog.count(*)
  into request_count
  from public.registration_requests
  where id = any(request_ids_input);

  if request_count <> pg_catalog.array_length(request_ids_input, 1) then
    raise exception 'Không tìm thấy đầy đủ yêu cầu đăng ký.' using errcode = 'P0002';
  end if;
  if exists (
    select 1
    from public.registration_requests
    where id = any(request_ids_input)
      and pg_catalog.regexp_replace(coalesce(phone, ''), '[^0-9+]', '', 'g') <> normalized_phone
  ) then
    raise exception 'Số điện thoại không khớp lô đăng ký.' using errcode = '42501';
  end if;
  if exists (
    select 1
    from public.registration_requests
    where id = any(request_ids_input)
      and status <> 'awaiting_payment'
  ) then
    raise exception 'Lô đăng ký không còn ở trạng thái chờ thanh toán.' using errcode = '22023';
  end if;

  select b.*
  into batch_record
  from public.registration_batches b
  join public.registration_requests r on r.registration_batch_id = b.id
  where r.id = any(request_ids_input)
  order by b.id
  limit 1
  for update of b;

  if found then
    if exists (
      select 1
      from public.registration_requests
      where id = any(request_ids_input)
        and registration_batch_id is distinct from batch_record.id
    ) then
      raise exception 'Yêu cầu đã thuộc lô đăng ký khác.' using errcode = '23505';
    end if;
    if batch_record.status <> 'pending' then
      raise exception 'Lô đăng ký không còn chờ thanh toán.' using errcode = '22023';
    end if;
    select *
    into payment_record
    from public.payments
    where id = batch_record.payment_id
    for update;
    if not found or payment_record.payment_status <> 'pending' then
      raise exception 'Thanh toán đăng ký không còn chờ xử lý.' using errcode = '22023';
    end if;
    if batch_record.promotion_snapshot is null
      or batch_record.promotion_code is distinct from normalized_code then
      raise exception 'Mã ưu đãi của lô thanh toán đã được khóa.' using errcode = '22023';
    end if;
    return pg_catalog.jsonb_build_object(
      'batch', pg_catalog.to_jsonb(batch_record),
      'payment', pg_catalog.to_jsonb(payment_record),
      'promotion', batch_record.promotion_snapshot,
      'items', (
        select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'requestId', i.registration_request_id,
          'kioskId', i.kiosk_id,
          'name', k.facebook_name,
          'months', i.months,
          'paidMonths', i.paid_months,
          'bonusMonths', i.bonus_months,
          'effectiveMonths', i.effective_service_months,
          'pricePerMonth', i.price_per_month,
          'discount', i.discount,
          'totalAmount', i.total_amount,
          'promotionEligible', i.promotion_eligible
        ) order by i.id), '[]'::jsonb)
        from public.registration_batch_items i
        join public.kiosks k on k.id = i.kiosk_id
        where i.batch_id = batch_record.id
      ),
      'reused', true
    );
  end if;

  select *
  into customer_record
  from public.customers
  where pg_catalog.regexp_replace(coalesce(phone, ''), '[^0-9+]', '', 'g') = normalized_phone
  order by id
  limit 1
  for update;

  if not found then
    select *
    into request_record
    from public.registration_requests
    where id = any(request_ids_input)
    order by id
    limit 1;
    insert into public.customers(
      facebook_name, facebook_id, facebook_link, phone, address,
      status, total_kiosks, total_paid, note
    ) values (
      request_record.facebook_name,
      nullif(request_record.facebook_id, ''),
      request_record.facebook_link,
      request_record.phone,
      request_record.address,
      'pending', 0, 0, request_record.note
    ) returning * into customer_record;
  end if;

  insert into public.registration_batches(customer_id, phone, status, total_amount)
  values (customer_record.id, normalized_phone, 'pending', 0)
  returning * into batch_record;

  select case
    when nullif(pg_catalog.btrim(s.value), '') ~ '^[0-9]+$'
      then 'https://www.facebook.com/groups/' || pg_catalog.btrim(s.value) || '/user/'
    else null
  end
  into group_member_base_url
  from public.settings s
  where s.key = 'facebook_group_id';

  for request_record in
    select *
    from public.registration_requests
    where id = any(request_ids_input)
    order by id
    for update
  loop
    select *
    into package_record
    from public.business_types
    where id = request_record.business_type_id
      and is_active = true
    for share;

    if not found or package_record.price_per_month is null or package_record.price_per_month < 0 then
      raise exception 'Loại hình kinh doanh không tồn tại, không hoạt động hoặc thiếu giá.' using errcode = '22023';
    end if;
    if request_record.months is null
      or request_record.months < 1
      or coalesce(request_record.discount, 0) <> 0 then
      raise exception 'Thời hạn không hợp lệ hoặc đăng ký công khai chứa giảm giá không được phép.' using errcode = '22023';
    end if;

    item_total := package_record.price_per_month * request_record.months;
    if item_total <= 0 or request_record.total_amount is distinct from item_total then
      raise exception 'Tổng tiền Kiosk không khớp giá hiện hành.' using errcode = '22023';
    end if;

    if request_record.kiosk_id is not null then
      select * into kiosk_record
      from public.kiosks
      where id = request_record.kiosk_id
      for update;
    else
      kiosk_record := null;
    end if;

    if kiosk_record.id is null then
      insert into public.kiosks(
        customer_id, facebook_name, facebook_id, facebook_link, facebook_group_link,
        category_id, business_type_id, service_name, start_date, end_date,
        status, auto_approve, total_paid, kiosk_total_paid, last_payment_date,
        note, is_primary
      ) values (
        customer_record.id,
        request_record.facebook_name,
        nullif(request_record.facebook_id, ''),
        request_record.facebook_link,
        case
          when group_member_base_url is null or nullif(request_record.facebook_id, '') is null then null
          else group_member_base_url || request_record.facebook_id || '/'
        end,
        package_record.category_id,
        package_record.id,
        package_record.name,
        null, null, 'pending', false, 0, 0, null,
        request_record.note,
        not exists (
          select 1 from public.kiosks k
          where k.customer_id = customer_record.id and k.is_primary
        )
      ) returning * into kiosk_record;
    elsif kiosk_record.customer_id <> customer_record.id then
      raise exception 'Kiosk không thuộc khách hàng của lô đăng ký.' using errcode = '23505';
    end if;

    first_kiosk_id := coalesce(first_kiosk_id, kiosk_record.id);

    insert into public.registration_batch_items(
      batch_id, registration_request_id, kiosk_id, business_type_id,
      months, paid_months, bonus_months, effective_service_months,
      price_per_month, discount, total_amount, promotion_eligible
    ) values (
      batch_record.id, request_record.id, kiosk_record.id, package_record.id,
      request_record.months, request_record.months, 0, request_record.months,
      package_record.price_per_month, 0, item_total, false
    );

    update public.registration_requests
    set customer_id = customer_record.id,
        kiosk_id = kiosk_record.id,
        registration_batch_id = batch_record.id,
        metadata = coalesce(metadata, '{}'::jsonb) || pg_catalog.jsonb_build_object(
          'materialized_for_checkout_v3_at', pg_catalog.now(),
          'promotion_code', normalized_code
        )
    where id = request_record.id;

    authoritative_total := authoritative_total + item_total;
  end loop;

  if authoritative_total <= 0 then
    raise exception 'Tổng tiền lô đăng ký không hợp lệ.' using errcode = '22023';
  end if;

  insert into public.payments(
    customer_id, kiosk_id, start_date, end_date, months, price_per_month,
    discount, total_amount, payment_method, payment_status, transaction_type,
    note, payment_intent_key, registration_batch_id
  ) values (
    customer_record.id, first_kiosk_id, null, null, 1, authoritative_total,
    0, authoritative_total, 'transfer', 'pending', 'standard',
    'Public registration checkout v3 batch #' || batch_record.id,
    'registration-batch:' || batch_record.id,
    batch_record.id
  ) returning * into payment_record;

  update public.registration_batches
  set payment_id = payment_record.id,
      total_amount = authoritative_total,
      updated_at = pg_catalog.now()
  where id = batch_record.id
  returning * into batch_record;

  update public.registration_requests
  set payment_id = payment_record.id
  where registration_batch_id = batch_record.id;

  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'itemId', i.id,
    'kioskId', i.kiosk_id,
    'months', i.months,
    'totalAmount', i.total_amount,
    'businessTypeId', i.business_type_id,
    'categoryId', bt.category_id
  ) order by i.id)
  into evaluation_items
  from public.registration_batch_items i
  join public.business_types bt on bt.id = i.business_type_id
  where i.batch_id = batch_record.id;

  evaluation := private.evaluate_registration_promotion(
    normalized_code,
    customer_record.id,
    evaluation_items
  );
  if not coalesce((evaluation->>'valid')::boolean, false) then
    raise exception '%', evaluation->>'message' using errcode = 'P0001';
  end if;

  update public.registration_batches
  set promotion_id = nullif(evaluation->>'promotionId', '')::bigint,
      promotion_code = evaluation->>'code',
      promotion_snapshot = evaluation,
      subtotal_before_discount = (evaluation->>'subtotal')::bigint,
      eligible_subtotal = (evaluation->>'eligibleSubtotal')::bigint,
      discount_amount = (evaluation->>'discountAmount')::bigint,
      total_amount = (evaluation->>'finalAmount')::bigint,
      updated_at = pg_catalog.now()
  where id = batch_record.id
  returning * into batch_record;

  perform pg_catalog.set_config('app.payment_workflow_action', 'edit', true);
  update public.payments
  set price_per_month = (evaluation->>'subtotal')::bigint,
      discount = (evaluation->>'discountAmount')::bigint,
      discount_reason = case when normalized_code is null then null else 'Promotion ' || normalized_code end,
      total_amount = (evaluation->>'finalAmount')::bigint
  where id = payment_record.id
  returning * into payment_record;

  update public.registration_batch_items i
  set promotion_eligible = coalesce((x.value->>'eligible')::boolean, false),
      bonus_months = coalesce((x.value->>'bonusMonths')::integer, 0),
      effective_service_months = coalesce((x.value->>'effectiveMonths')::integer, i.months)
  from pg_catalog.jsonb_array_elements(evaluation->'items') x
  where i.id = (x.value->>'itemId')::bigint;

  if (evaluation->>'discountAmount')::bigint > 0 then
    with eligible_items as (
      select i.id,
        i.total_amount,
        pg_catalog.floor(
          (evaluation->>'discountAmount')::numeric * i.total_amount
          / (evaluation->>'eligibleSubtotal')::numeric
        )::bigint as base_discount
      from public.registration_batch_items i
      where i.batch_id = batch_record.id and i.promotion_eligible
    ), ranked as (
      select e.*,
        pg_catalog.row_number() over (order by e.id) as allocation_rank,
        (evaluation->>'discountAmount')::bigint
          - pg_catalog.sum(e.base_discount) over () as remainder
      from eligible_items e
    )
    update public.registration_batch_items i
    set discount = r.base_discount + case when r.allocation_rank <= r.remainder then 1 else 0 end,
        total_amount = i.total_amount - (
          r.base_discount + case when r.allocation_rank <= r.remainder then 1 else 0 end
        )
    from ranked r
    where i.id = r.id;
  end if;

  if batch_record.total_amount is distinct from (
    select coalesce(pg_catalog.sum(i.total_amount), 0)
    from public.registration_batch_items i
    where i.batch_id = batch_record.id
  ) then
    raise exception 'Phân bổ ưu đãi không khớp tổng thanh toán.' using errcode = '23514';
  end if;

  update public.customers c
  set total_kiosks = (
    select pg_catalog.count(*) from public.kiosks k where k.customer_id = c.id
  )
  where c.id = customer_record.id;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'requestId', i.registration_request_id,
    'kioskId', i.kiosk_id,
    'name', k.facebook_name,
    'months', i.months,
    'paidMonths', i.paid_months,
    'bonusMonths', i.bonus_months,
    'effectiveMonths', i.effective_service_months,
    'pricePerMonth', i.price_per_month,
    'discount', i.discount,
    'totalAmount', i.total_amount,
    'promotionEligible', i.promotion_eligible
  ) order by i.id), '[]'::jsonb)
  into result_items
  from public.registration_batch_items i
  join public.kiosks k on k.id = i.kiosk_id
  where i.batch_id = batch_record.id;

  perform private.write_ttc_audit('Registration','registration_pending','registration_batches',batch_record.id::text,null,pg_catalog.jsonb_build_object('payment_id',payment_record.id,'kiosk_name',(select string_agg(k.facebook_name,', ' order by i.id) from public.registration_batch_items i join public.kiosks k on k.id=i.kiosk_id where i.batch_id=batch_record.id),'amount',payment_record.total_amount,'kiosk_count',request_count),'Đăng ký Kiosk – Chờ thanh toán');
  return pg_catalog.jsonb_build_object(
    'batch', pg_catalog.to_jsonb(batch_record),
    'payment', pg_catalog.to_jsonb(payment_record),
    'promotion', evaluation,
    'items', result_items,
    'reused', false
  );
end;
$function$;
alter table public.payos_orders add column reconciliation_required boolean not null default false;
alter table public.payos_orders add column reconciliation_reason text;
alter table public.payments add column promotion_snapshot jsonb;
alter table public.payments add column bonus_months integer not null default 0 check (bonus_months>=0);
alter table public.promotion_usages alter column registration_batch_id drop not null;
alter table private.public_renewal_authorizations add column payment_id bigint references public.payments(id);
create or replace function private.mark_payos_review(order_id_input bigint, reason_input text, event_id_input bigint default null)
returns void language plpgsql security definer set search_path='' as $$
declare o public.payos_orders%rowtype;
begin
  update public.payos_orders set reconciliation_required=true,reconciliation_reason=reason_input,updated_at=now()
  where id=order_id_input and not reconciliation_required returning * into o;
  if found then
    perform private.write_ttc_audit('Payment','payment_review_required','payos_orders',o.id::text,null,
      jsonb_build_object('payment_id',o.payment_id,'order_code',o.order_code,'amount',o.amount,'review_reason',reason_input),
      'Giao dịch PayOS cần đối soát; chưa tự động kích hoạt hoặc gia hạn');
  end if;
  if event_id_input is not null then
    update public.payos_webhook_events set status='failed',error=reason_input,processed_at=now() where id=event_id_input;
  end if;
end $$;
revoke all on function private.mark_payos_review(bigint,text,bigint) from public;
-- Provider status reads may close an unpaid checkout, but can never complete money/service.
create or replace function public.sync_payos_order_status(order_code_input bigint, provider_input jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.payos_orders%rowtype; provider_status text;
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Chỉ API server được đồng bộ PayOS.' using errcode='42501'; end if;
  select * into o from public.payos_orders where order_code=order_code_input;
  if not found then raise exception 'Không tìm thấy PayOS order.' using errcode='P0002'; end if;
  if o.payment_id is not null then perform 1 from public.payments where id=o.payment_id for update; end if;
  select * into o from public.payos_orders where id=o.id for update;
  if provider_input is not null then
    if (provider_input->>'orderCode')::bigint is distinct from o.order_code
      or (provider_input->>'amount')::numeric is distinct from o.amount
      or (o.payment_link_id is not null and provider_input->>'id' is distinct from o.payment_link_id) then
      perform private.mark_payos_review(o.id,'PROVIDER_MAPPING_MISMATCH');
    else
      provider_status:=upper(provider_input->>'status');
      update public.payos_orders set provider_payload=provider_payload||jsonb_build_object('_status',provider_input,'_status_checked_at',now()),
        status=case when status='pending' and provider_status in ('EXPIRED','CANCELLED') then lower(provider_status) else status end,
        active_slot=case when provider_status in ('EXPIRED','CANCELLED') then null else active_slot end,
        updated_at=now() where id=o.id;
      if coalesce((provider_input->>'amountPaid')::numeric,0)>0 and provider_status<>'PAID' then
        perform private.mark_payos_review(o.id,'PARTIAL_OR_LATE_PROVIDER_PAYMENT');
      end if;
    end if;
  end if;
  update public.payos_orders set status='expired',active_slot=null,updated_at=now()
    where id=o.id and status='pending' and expires_at<=now()
      and coalesce(provider_status,'')<>'PAID';
  select * into o from public.payos_orders where id=o.id;
  return to_jsonb(o);
end $$;
revoke all on function public.sync_payos_order_status(bigint,jsonb) from public,anon,authenticated;
grant execute on function public.sync_payos_order_status(bigint,jsonb) to service_role;
create or replace function public.handle_payos_webhook(order_code_input bigint, amount_input numeric,
 payment_link_id_input text default null, reference_input text default null, provider_payload_input jsonb default '{}'::jsonb,
 signature_input text default null,event_key_input text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.payos_orders%rowtype; p public.payments%rowtype; e public.payos_webhook_events%rowtype;
 result jsonb; review_reason text; event_key_value text;
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Chỉ webhook server được xác nhận PayOS.' using errcode='42501'; end if;
  event_key_value:='payos:'||order_code_input::text||':'||coalesce(nullif(btrim(reference_input),''),nullif(btrim(payment_link_id_input),''),'paid');
  insert into public.payos_webhook_events(event_key,order_code,signature,payload)
    values(event_key_value,order_code_input,signature_input,coalesce(provider_payload_input,'{}'::jsonb))
    on conflict(event_key) do nothing;
  select * into e from public.payos_webhook_events where event_key=event_key_value for update;
  if e.status in ('processed','failed') then
    return jsonb_build_object('already_processed',true,'reconciliation_required',e.status='failed');
  end if;
  select * into o from public.payos_orders where order_code=order_code_input;
  if not found then
    update public.payos_webhook_events set status='failed',error='UNKNOWN_ORDER',processed_at=now() where id=e.id;
    perform private.write_ttc_audit('Payment','payment_review_required','payos_webhook_events',e.id::text,null,
      jsonb_build_object('order_code',order_code_input,'amount',amount_input),'PayOS chuyển tiền nhưng không tìm thấy đơn; cần đối soát');
    return jsonb_build_object('reconciliation_required',true,'ignored',true);
  end if;
  -- Match the reservation lock order: business payment first, then provider order.
  if o.payment_id is not null then select * into p from public.payments where id=o.payment_id for update; end if;
  select * into o from public.payos_orders where id=o.id for update;
  if o.amount is distinct from amount_input or amount_input<=0 then review_reason:='AMOUNT_MISMATCH';
  elsif nullif(payment_link_id_input,'') is null or o.payment_link_id is distinct from payment_link_id_input then review_reason:='PAYMENT_LINK_MISMATCH';
  elsif nullif(reference_input,'') is null then review_reason:='MISSING_BANK_REFERENCE';
  elsif o.status='paid' then
    if exists(select 1 from public.payos_webhook_events prior where prior.order_code=o.order_code and prior.status='processed'
      and prior.payload->'data'->>'reference'=reference_input) then
      update public.payos_webhook_events set status='processed',processed_at=now() where id=e.id;
      return jsonb_build_object('already_processed',true);
    end if;
    review_reason:='ADDITIONAL_TRANSFER_ON_PAID_ORDER';
  elsif o.reconciliation_required then review_reason:=o.reconciliation_reason;
  -- Checkout expiry / replacement never invalidates a bank transfer.
  -- Any correctly mapped attempt may win while the business payment is pending.
  elsif o.purpose='crm_payment' and exists(select 1 from public.payos_orders sibling where sibling.payment_id=p.id and sibling.reconciliation_required) then review_reason:='INTENT_REQUIRES_REVIEW';
  elsif o.purpose='crm_payment' and (p.id is null or p.total_amount is distinct from amount_input) then review_reason:='BUSINESS_PAYMENT_MISMATCH';
  elsif o.purpose='crm_payment' and p.payment_status<>'pending' then review_reason:='BUSINESS_PAYMENT_ALREADY_CLOSED';
  end if;
  if review_reason is not null then
    perform private.mark_payos_review(o.id,review_reason,e.id);
    return jsonb_build_object('reconciliation_required',true,'ignored',true,'reason',review_reason);
  end if;
  -- A subtransaction preserves the signed evidence and review state if business
  -- validation (e.g. coupon quota or cancelled registration) rejects finalization.
  begin
    if o.purpose='crm_payment' then
      if p.registration_batch_id is not null then
        result:=private.confirm_registration_batch_from_payos(p.id,'PayOS paid: '||reference_input);
      else
        result:=private.confirm_crm_payment_from_payos(p.id,'PayOS paid: '||reference_input);
        update public.registration_requests set status='approved',reviewed_at=coalesce(reviewed_at,now())
          where payment_id=p.id and status in ('pending','awaiting_payment');
      end if;
      -- Stop offering sibling checkouts without discarding their late-payment mapping.
      update public.payos_orders set active_slot=null,updated_at=now()
        where payment_id=p.id and id<>o.id and active_slot is true;
    elsif o.purpose='wallet_topup' then
      result:=private.post_wallet_ledger(o.wallet_user_id,o.amount,'admin_adjustment','payos_orders',o.id::text,
        'payos-paid:'||o.order_code::text,'Nạp xu PayOS','PayOS paid: '||reference_input,
        jsonb_build_object('source','payos','order_code',o.order_code),null,'system');
    else raise exception 'Mục đích PayOS không hợp lệ.'; end if;
    update public.payos_orders set status='paid',active_slot=null,confirmed_at=now(),processed_at=now(),
      provider_payload=provider_payload||provider_payload_input,updated_at=now() where id=o.id returning * into o;
    update public.payos_webhook_events set status='processed',processed_at=now() where id=e.id;
  exception when others then
    perform private.mark_payos_review(o.id,'FINALIZATION_REJECTED:'||sqlstate,e.id);
    return jsonb_build_object('reconciliation_required',true,'ignored',true);
  end;
  return jsonb_build_object('already_processed',false,'order',to_jsonb(o),'result',result);
end $$;
revoke all on function public.handle_payos_webhook(bigint,numeric,text,text,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.handle_payos_webhook(bigint,numeric,text,text,jsonb,text,text) to service_role;
-- One pending business renewal; coupon calculations reuse the registration engine.
create or replace function private.prepare_renewal_payment(kiosk_id_input bigint, months_input integer,
 promotion_code_input text, discount_input numeric, discount_reason_input text, note_input text, public_input boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare k public.kiosks%rowtype; bt public.business_types%rowtype; p public.payments%rowtype;
 evaluation jsonb; code_value text:=nullif(upper(btrim(promotion_code_input)),''); discount_value numeric:=coalesce(discount_input,0);
 intent_key text; actor public.user_roles%rowtype;
begin
  if months_input is null or months_input<1 or months_input>120 then raise exception 'Số tháng không hợp lệ.' using errcode='22023'; end if;
  -- All renewal entrypoints share the same kiosk lock before selecting a pending payment.
  perform pg_advisory_xact_lock(hashtextextended('renewal:'||kiosk_id_input::text,0));
  select * into k from public.kiosks where id=kiosk_id_input for update;
  if not found or not exists(select 1 from public.registered_kiosks where id=kiosk_id_input)
    or lower(k.status) not in ('active','warning','expired') then
    raise exception 'Kiosk chưa đủ điều kiện gia hạn.' using errcode='22023';
  end if;
  if code_value is not null and discount_value<>0 then raise exception 'Không cộng dồn mã giảm giá và giảm giá thủ công.' using errcode='22023'; end if;
  select * into p from public.payments where kiosk_id=k.id and payment_status='pending'
    and registration_batch_id is null and registration_request_id is null
    and (payment_intent_key like '%renewal:%' or note='Public PayOS Kiosk renewal') order by id limit 1 for update;
  if found then
    if p.months<>months_input or p.promotion_snapshot->>'code' is distinct from code_value
      or (code_value is null and p.discount<>discount_value) then
      raise exception 'Đã có yêu cầu gia hạn chờ thanh toán với gói hoặc ưu đãi khác. Liên hệ Admin để hủy yêu cầu cũ.' using errcode='P0001';
    end if;
    return jsonb_build_object('payment',to_jsonb(p),'kiosk_name',k.facebook_name,'reused',true);
  end if;
  select * into bt from public.business_types where id=k.business_type_id and is_active;
  if not found or bt.price_per_month<=0 then raise exception 'Giá gia hạn không hợp lệ.' using errcode='22023'; end if;
  evaluation:=private.evaluate_registration_promotion(code_value,k.customer_id,jsonb_build_array(jsonb_build_object(
    'itemId',k.id,'kioskId',k.id,'months',months_input,'totalAmount',bt.price_per_month*months_input,'businessTypeId',bt.id,'categoryId',bt.category_id)));
  if not coalesce((evaluation->>'valid')::boolean,false) then raise exception '%',evaluation->>'message' using errcode='P0001'; end if;
  if code_value is not null then discount_value:=(evaluation->>'discountAmount')::numeric; end if;
  if discount_value<0 or discount_value>=bt.price_per_month*months_input then raise exception 'Giảm giá không hợp lệ.' using errcode='22023'; end if;
  if code_value is null and discount_value>0 and nullif(btrim(discount_reason_input),'') is null then raise exception 'Cần lý do giảm giá.' using errcode='22023'; end if;
  intent_key:=case when public_input then 'public-renewal:' else 'admin-renewal:' end||k.id::text||':'||months_input::text;
  insert into public.payments(customer_id,kiosk_id,months,price_per_month,discount,discount_reason,total_amount,payment_method,payment_status,note,payment_intent_key,promotion_snapshot,bonus_months)
  values(k.customer_id,k.id,months_input,bt.price_per_month,discount_value,case when code_value is null then discount_reason_input else 'Promotion '||code_value end,
    bt.price_per_month*months_input-discount_value,'transfer','pending',case when public_input then 'Public PayOS Kiosk renewal' else note_input end,intent_key,
    evaluation,coalesce((evaluation->>'totalBonusMonths')::integer,0)) returning * into p;
  perform private.write_ttc_audit('Renewal','renewal_pending','payments',p.id::text,null,
    to_jsonb(p)||jsonb_build_object('kiosk_name',k.facebook_name),'Gia hạn Kiosk – Chờ thanh toán');
  return jsonb_build_object('payment',to_jsonb(p),'kiosk_name',k.facebook_name,'reused',false);
end $$;
revoke all on function private.prepare_renewal_payment(bigint,integer,text,numeric,text,text,boolean) from public;
create or replace function public.prepare_public_kiosk_renewal(kiosk_id_input bigint,months_input integer,nonce_hash_input text,promotion_code_input text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a private.public_renewal_authorizations%rowtype; result jsonb; p public.payments%rowtype;
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Chỉ API server được chuẩn bị gia hạn.' using errcode='42501'; end if;
  if months_input not in (1,3,6,12) then raise exception 'Thời hạn không được hỗ trợ.' using errcode='22023'; end if;
  select * into a from private.public_renewal_authorizations where nonce_hash=nonce_hash_input and kiosk_id=kiosk_id_input and expires_at>now() for update;
  if not found then raise exception 'Quyền gia hạn đã hết hạn.' using errcode='42501'; end if;
  if a.payment_id is not null then
    select * into p from public.payments where id=a.payment_id;
    if p.months<>months_input or p.promotion_snapshot->>'code' is distinct from nullif(upper(btrim(promotion_code_input)),'') then raise exception 'Gói gia hạn đã được khóa.' using errcode='22023'; end if;
    return jsonb_build_object('payment',to_jsonb(p),'kiosk_name',(select facebook_name from public.kiosks where id=kiosk_id_input),'reused',true);
  end if;
  if a.consumed_at is not null then raise exception 'Quyền cũ đã dùng; vui lòng tra cứu lại.' using errcode='42501'; end if;
  result:=private.prepare_renewal_payment(kiosk_id_input,months_input,promotion_code_input,0,null,null,true);
  update private.public_renewal_authorizations set consumed_at=now(),payment_id=(result->'payment'->>'id')::bigint where nonce_hash=nonce_hash_input;
  return result;
end $$;
revoke all on function public.prepare_public_kiosk_renewal(bigint,integer,text,text) from public,anon,authenticated;
grant execute on function public.prepare_public_kiosk_renewal(bigint,integer,text,text) to service_role;
create or replace function public.prepare_public_kiosk_renewal(kiosk_id_input bigint,months_input integer,nonce_hash_input text)
returns jsonb language sql security definer set search_path='' as $$select public.prepare_public_kiosk_renewal(kiosk_id_input,months_input,nonce_hash_input,null)$$;
create or replace function public.resume_public_kiosk_renewal(payment_id_input bigint,kiosk_id_input bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.payments%rowtype;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Chỉ API server được tiếp tục thanh toán.' using errcode='42501'; end if;
 select * into p from public.payments where id=payment_id_input and kiosk_id=kiosk_id_input
   and payment_intent_key like 'public-renewal:%';
 if not found or p.payment_status<>'pending' then raise exception 'Yêu cầu gia hạn đã kết thúc.' using errcode='22023'; end if;
 return jsonb_build_object('payment',to_jsonb(p),'kiosk_name',(select facebook_name from public.kiosks where id=kiosk_id_input),'reused',true);
end $$;
revoke all on function public.resume_public_kiosk_renewal(bigint,bigint) from public,anon,authenticated;
grant execute on function public.resume_public_kiosk_renewal(bigint,bigint) to service_role;
create or replace function public.create_renewal_payment(kiosk_id_input bigint,months_input integer,discount_input numeric,
 discount_reason_input text,note_input text,promotion_code_input text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform private.assert_payment_permission();
 return private.prepare_renewal_payment(kiosk_id_input,months_input,promotion_code_input,discount_input,discount_reason_input,note_input,false);
end $$;
revoke all on function public.create_renewal_payment(bigint,integer,numeric,text,text,text) from public,anon;
grant execute on function public.create_renewal_payment(bigint,integer,numeric,text,text,text) to authenticated;
create or replace function public.create_renewal_payment(kiosk_id_input bigint,months_input integer,discount_input numeric default 0,
 discount_reason_input text default null,note_input text default null)
returns jsonb language sql security definer set search_path='' as $$select public.create_renewal_payment(kiosk_id_input,months_input,discount_input,discount_reason_input,note_input,null)$$;
create or replace function public.preview_renewal_promotion(kiosk_id_input bigint,months_input integer,promotion_code_input text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare k public.kiosks%rowtype; bt public.business_types%rowtype; evaluation jsonb; service_start date;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then perform private.assert_payment_permission(); end if;
 if months_input is null or months_input<1 or months_input>120 then raise exception 'Số tháng không hợp lệ.'; end if;
 select * into k from public.kiosks where id=kiosk_id_input;
 if not found or not exists(select 1 from public.registered_kiosks where id=k.id) then raise exception 'Kiosk chưa đủ điều kiện gia hạn.'; end if;
 select * into bt from public.business_types where id=k.business_type_id and is_active;
 if not found or bt.price_per_month<=0 then raise exception 'Giá gia hạn không hợp lệ.'; end if;
 evaluation:=private.evaluate_registration_promotion(promotion_code_input,k.customer_id,jsonb_build_array(jsonb_build_object(
   'months',months_input,'totalAmount',bt.price_per_month*months_input,'businessTypeId',bt.id,'categoryId',bt.category_id)));
 service_start:=greatest(coalesce(k.end_date+1,(now() at time zone 'Asia/Ho_Chi_Minh')::date),(now() at time zone 'Asia/Ho_Chi_Minh')::date);
 return evaluation||jsonb_build_object('proposedExpiry',(service_start+make_interval(months=>months_input+coalesce((evaluation->>'totalBonusMonths')::integer,0))-interval '1 day')::date);
end $$;
revoke all on function public.preview_renewal_promotion(bigint,integer,text) from public,anon;
grant execute on function public.preview_renewal_promotion(bigint,integer,text) to authenticated,service_role;
create or replace function private.finalize_renewal_promotion_usage()
returns trigger language plpgsql security definer set search_path='' as $$
declare promo public.promotions%rowtype; s jsonb:=new.promotion_snapshot;
begin
 if new.payment_status<>'completed' or old.payment_status='completed' or new.registration_batch_id is not null or s->>'promotionId' is null then return new; end if;
 select * into promo from public.promotions where id=(s->>'promotionId')::bigint for update;
 if not found then raise exception 'Không tìm thấy mã ưu đãi đã chốt.'; end if;
 if promo.usage_limit_total is not null and (select count(*) from public.promotion_usages where promotion_id=promo.id)>=promo.usage_limit_total then raise exception 'Mã đã hết lượt sử dụng.'; end if;
 if promo.usage_limit_per_customer is not null and (select count(*) from public.promotion_usages where promotion_id=promo.id and customer_id=new.customer_id)>=promo.usage_limit_per_customer then raise exception 'Khách hàng đã hết lượt mã.'; end if;
 insert into public.promotion_usages(promotion_id,customer_id,payment_id,code_snapshot,discount_type_snapshot,discount_value_snapshot,subtotal_before_discount,eligible_subtotal,discount_amount,final_amount,total_bonus_months)
 values(promo.id,new.customer_id,new.id,s->>'code',s->>'discountType',(s->>'discountValue')::bigint,(s->>'subtotal')::bigint,(s->>'eligibleSubtotal')::bigint,new.discount,new.total_amount,new.bonus_months)
 on conflict(payment_id) do nothing;
 return new;
end $$;
revoke all on function private.finalize_renewal_promotion_usage() from public;
create trigger finalize_renewal_promotion_usage_trigger after update of payment_status on public.payments
for each row execute function private.finalize_renewal_promotion_usage();
CREATE OR REPLACE FUNCTION private.reserve_crm_payos_order(payment_id_input bigint, order_code_input bigint, amount_input numeric, description_input text, checkout_url_input text, qr_code_input text, payment_link_id_input text, provider_payload_input jsonb)
 RETURNS payos_orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare payment_record public.payments%rowtype; order_record public.payos_orders%rowtype; old_order public.payos_orders%rowtype;
declare expiry timestamptz;
begin
  select * into payment_record from public.payments where id=payment_id_input for update;
  if not found or payment_record.payment_status<>'pending' or payment_record.total_amount<>amount_input then raise exception 'Thanh toán Pending không hợp lệ.' using errcode='22023'; end if;
  if exists(select 1 from public.payos_orders where payment_id=payment_id_input and
    (reconciliation_required or (status<>'paid' and provider_payload->'_status'->>'status'='PAID'))) then
    raise exception 'Thanh toán cần đối soát hoặc đang chờ webhook; không tạo thêm mã.' using errcode='P0001';
  end if;
  select * into order_record from public.payos_orders where order_code=order_code_input for update;
  if found then
    if order_record.payment_id is distinct from payment_id_input or order_record.purpose<>'crm_payment' or order_record.amount<>amount_input
      or (order_record.payment_link_id is not null and nullif(payment_link_id_input,'') is not null and order_record.payment_link_id<>payment_link_id_input) then
      raise exception 'Không được đổi liên kết PayOS order.' using errcode='22023';
    end if;
    if order_record.status<>'pending' then return order_record; end if;
    update public.payos_orders set checkout_url=coalesce(nullif(checkout_url_input,''),checkout_url),qr_code=coalesce(nullif(qr_code_input,''),qr_code),
      payment_link_id=coalesce(nullif(payment_link_id_input,''),payment_link_id),provider_payload=provider_payload||coalesce(provider_payload_input,'{}'::jsonb),updated_at=now()
      where id=order_record.id returning * into order_record;
    return order_record;
  end if;
  begin expiry := to_timestamp((provider_payload_input->>'expiresAt')::bigint); exception when others then expiry := null; end;
  select * into old_order from public.payos_orders where payment_id=payment_id_input and purpose='crm_payment' and status='pending' and active_slot is true order by id desc limit 1 for update;
  if found and old_order.order_code<>order_code_input then
    if old_order.expires_at is null or old_order.expires_at>now() then raise exception 'Thanh toán đã có một mã PayOS còn hiệu lực.' using errcode='23505'; end if;
    update public.payos_orders set status='expired',active_slot=null,processed_at=coalesce(processed_at,now()),updated_at=now() where id=old_order.id;
  end if;
  insert into public.payos_orders(order_code,purpose,payment_id,amount,description,checkout_url,qr_code,payment_link_id,provider_payload,created_by,expires_at,active_slot)
  values(order_code_input,'crm_payment',payment_id_input,amount_input,nullif(trim(description_input),''),nullif(trim(checkout_url_input),''),nullif(trim(qr_code_input),''),nullif(trim(payment_link_id_input),''),coalesce(provider_payload_input,'{}'::jsonb),auth.uid(),expiry,true)
  on conflict(order_code) do update set checkout_url=excluded.checkout_url,qr_code=excluded.qr_code,payment_link_id=excluded.payment_link_id,
    provider_payload=excluded.provider_payload,expires_at=coalesce(excluded.expires_at,public.payos_orders.expires_at),updated_at=now()
  where public.payos_orders.status='pending' returning * into order_record;
  if old_order.id is not null and old_order.id<>order_record.id then update public.payos_orders set superseded_by_order_id=order_record.id where id=old_order.id; end if;
  return order_record;
end;$function$;
CREATE OR REPLACE FUNCTION private.confirm_crm_payment_from_payos(payment_id_input bigint, reason_input text DEFAULT 'PayOS paid'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  payment_record public.payments%rowtype;
  before_record public.payments%rowtype;
  customer_record public.customers%rowtype;
  kiosk_record public.kiosks%rowtype;
  package_record public.business_types%rowtype;
  confirmation_timestamp timestamptz := pg_catalog.now();
  confirmation_date date := (pg_catalog.now() at time zone 'Asia/Ho_Chi_Minh')::date;
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
  select * into package_record from public.business_types where id = kiosk_record.business_type_id and is_active = true;
  if not found then raise exception 'Gói dịch vụ không tồn tại hoặc đã ngừng hoạt động.'; end if;
  if payment_record.months is null or payment_record.months < 1 then raise exception 'Số tháng thanh toán không hợp lệ.'; end if;
  if payment_record.price_per_month is null or payment_record.price_per_month < 0
    or payment_record.discount is null or payment_record.discount < 0
    or payment_record.total_amount is null or payment_record.total_amount <= 0 then
    raise exception 'Giá trị tài chính của thanh toán không hợp lệ.';
  end if;
  expected_total := payment_record.price_per_month * payment_record.months - payment_record.discount;
  if payment_record.total_amount <> expected_total then raise exception 'Tổng tiền không khớp giá, số tháng và giảm giá.'; end if;

  effective_start_date := case
    when kiosk_record.end_date is not null and kiosk_record.end_date >= confirmation_date
      then kiosk_record.end_date + 1
    else confirmation_date
  end;
  calculated_end_date := (
    effective_start_date
    + pg_catalog.make_interval(months => payment_record.months + payment_record.bonus_months)
    - interval '1 day'
  )::date;

  perform pg_catalog.set_config('app.payment_workflow_action', 'confirm', true);
  update public.payments
  set payment_status = 'completed', confirmed_by = auth.uid()::text, confirmed_at = confirmation_timestamp,
      start_date = effective_start_date, end_date = calculated_end_date
  where id = payment_record.id
  returning * into payment_record;

  update public.kiosks
  set status = 'active', start_date=coalesce(start_date,effective_start_date), end_date = calculated_end_date
  where id = kiosk_record.id;

  update public.customers
  set status = case when lower(coalesce(status, '')) = 'pending' then 'active' else status end,
      total_kiosks = (select count(*) from public.kiosks k where k.customer_id = customer_record.id)
  where id = customer_record.id;

  perform private.write_ttc_audit(
    'Payment', case when payment_record.payment_intent_key like '%renewal:%' then 'renewal_paid' else 'confirm_payos' end, 'payments', payment_record.id::text,
    to_jsonb(before_record), to_jsonb(payment_record)||jsonb_build_object('kiosk_name',kiosk_record.facebook_name,'old_expiry_date',kiosk_record.end_date), reason_input
  );
  return jsonb_build_object(
    'payment', to_jsonb(payment_record),
    'kiosk', (select to_jsonb(k) from public.kiosks k where k.id = kiosk_record.id),
    'customer', (select to_jsonb(c) from public.customers c where c.id = customer_record.id)
  );
end;
$function$;
CREATE OR REPLACE FUNCTION private.confirm_registration_batch_from_payos(payment_id_input bigint, reason_input text DEFAULT 'PayOS paid'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare payment_record public.payments%rowtype; batch_record public.registration_batches%rowtype; item_record record; confirmation_timestamp timestamptz:=pg_catalog.now(); confirmation_date date:=(pg_catalog.now() at time zone 'Asia/Ho_Chi_Minh')::date; calculated_end date; item_count integer:=0;
begin
  select * into payment_record from public.payments where id=payment_id_input for update;
  if not found or payment_record.registration_batch_id is null then raise exception 'Không tìm thấy thanh toán lô đăng ký.' using errcode='P0002'; end if;
  select * into batch_record from public.registration_batches where id=payment_record.registration_batch_id for update;
  if not found or batch_record.payment_id<>payment_record.id then raise exception 'Liên kết thanh toán lô đăng ký không hợp lệ.' using errcode='22023'; end if;
  if payment_record.payment_status<>'pending' or batch_record.status<>'pending' then raise exception 'Lô đăng ký không còn Pending.' using errcode='22023'; end if;
  if payment_record.total_amount<>batch_record.total_amount or batch_record.total_amount<>(select coalesce(sum(total_amount),0) from public.registration_batch_items where batch_id=batch_record.id) then raise exception 'Tổng tiền lô đăng ký không khớp.' using errcode='22023'; end if;
  perform 1 from public.registration_batch_items i join public.kiosks k on k.id=i.kiosk_id join public.registration_requests r on r.id=i.registration_request_id where i.batch_id=batch_record.id order by i.id for update of i,k,r;
  if exists(select 1 from public.registration_batch_items i join public.registration_requests r on r.id=i.registration_request_id where i.batch_id=batch_record.id and r.status not in ('pending','awaiting_payment')) then raise exception 'Hồ sơ đăng ký đã bị đóng.' using errcode='22023'; end if;
  for item_record in select i.*,k.facebook_name from public.registration_batch_items i join public.kiosks k on k.id=i.kiosk_id where i.batch_id=batch_record.id order by i.id loop
    calculated_end:=(confirmation_date+pg_catalog.make_interval(months=>item_record.effective_service_months)-interval '1 day')::date;
    update public.registration_batch_items set start_date=confirmation_date,end_date=calculated_end where id=item_record.id;
    update public.kiosks set status='active',start_date=confirmation_date,end_date=calculated_end where id=item_record.kiosk_id;
    update public.registration_requests set status='approved',requested_start_date=confirmation_date,requested_end_date=calculated_end,reviewed_at=coalesce(reviewed_at,confirmation_timestamp) where id=item_record.registration_request_id;
    item_count:=item_count+1;
  end loop;
  if item_count<1 then raise exception 'Lô đăng ký không có Kiosk.' using errcode='22023'; end if;
  perform pg_catalog.set_config('app.payment_workflow_action','confirm',true);
  update public.payments set payment_status='completed',confirmed_by=null,confirmed_at=confirmation_timestamp where id=payment_record.id returning * into payment_record;
  update public.registration_batches set status='approved',approved_at=confirmation_timestamp,updated_at=confirmation_timestamp where id=batch_record.id returning * into batch_record;
  update public.customers set status=case when pg_catalog.lower(coalesce(status,''))='pending' then 'active' else status end,total_kiosks=(select count(*) from public.kiosks k where k.customer_id=batch_record.customer_id) where id=batch_record.customer_id;
  perform private.write_ttc_audit('Payment','confirm_payos_batch','registration_batches',batch_record.id::text,null,jsonb_build_object('payment_id',payment_record.id,'amount',payment_record.total_amount,'kiosk_count',item_count,'kiosk_name',(select string_agg(k.facebook_name,', ' order by i.id) from public.registration_batch_items i join public.kiosks k on k.id=i.kiosk_id where i.batch_id=batch_record.id)),reason_input);
  return jsonb_build_object('payment',to_jsonb(payment_record),'batch',to_jsonb(batch_record),'items',(select jsonb_agg(jsonb_build_object('id',k.id,'name',k.facebook_name,'startDate',i.start_date,'endDate',i.end_date,'status',k.status) order by i.id) from public.registration_batch_items i join public.kiosks k on k.id=i.kiosk_id where i.batch_id=batch_record.id));
end;$function$;
CREATE OR REPLACE FUNCTION private.protect_payment_records()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  workflow_action text := coalesce(
    pg_catalog.current_setting('app.payment_workflow_action', true),
    ''
  );
begin
  if tg_op = 'DELETE' then
    raise exception 'Thanh toán không bao giờ được xóa cứng.' using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    if pg_catalog.lower(coalesce(new.payment_status, '')) <> 'pending'
      and workflow_action <> 'adjustment' then
      raise exception 'Thanh toán mới phải bắt đầu ở trạng thái Pending.' using errcode = '23514';
    end if;
    return new;
  end if;

  if (new.promotion_snapshot,new.bonus_months) is distinct from (old.promotion_snapshot,old.bonus_months) then
    raise exception 'Ưu đãi đã được chốt theo thanh toán, không được sửa trực tiếp.' using errcode='23514';
  end if;
  if pg_catalog.lower(old.payment_status) = 'completed' then
    if workflow_action = 'historical_correction' then
      -- Future columns are protected by default. Only these four explicitly
      -- audited historical fields may differ inside the dedicated RPC.
      if (
        pg_catalog.to_jsonb(new)
          - array['start_date', 'end_date', 'months', 'total_amount']::text[]
      ) is distinct from (
        pg_catalog.to_jsonb(old)
          - array['start_date', 'end_date', 'months', 'total_amount']::text[]
      ) then
        raise exception 'Sửa dữ liệu lịch sử chỉ được đổi ngày, số tháng và số tiền.'
          using errcode = '42501';
      end if;
      return new;
    end if;

    if new.id is distinct from old.id
      or new.created_at is distinct from old.created_at
      or new.customer_id is distinct from old.customer_id
      or new.kiosk_id is distinct from old.kiosk_id
      or new.start_date is distinct from old.start_date
      or new.end_date is distinct from old.end_date
      or new.months is distinct from old.months
      or new.price_per_month is distinct from old.price_per_month
      or new.discount is distinct from old.discount
      or new.discount_reason is distinct from old.discount_reason
      or new.total_amount is distinct from old.total_amount
      or new.payment_method is distinct from old.payment_method
      or new.payment_status is distinct from old.payment_status
      or new.confirmed_at is distinct from old.confirmed_at
      or new.confirmed_by is distinct from old.confirmed_by
      or new.transaction_type is distinct from old.transaction_type
      or new.adjusts_payment_id is distinct from old.adjusts_payment_id
      or new.adjustment_reason is distinct from old.adjustment_reason
      or new.service_month_delta is distinct from old.service_month_delta then
      raise exception 'Không được sửa trường tài chính của thanh toán Completed. Hãy tạo giao dịch điều chỉnh.'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if pg_catalog.lower(old.payment_status) in ('rejected', 'cancelled') then
    if new is distinct from old then
      raise exception 'Thanh toán Rejected/Cancelled là trạng thái kết thúc.' using errcode = '23514';
    end if;
    return new;
  end if;

  if pg_catalog.lower(old.payment_status) <> 'pending' then
    raise exception 'Trạng thái thanh toán hiện tại không hợp lệ.' using errcode = '23514';
  end if;
  if pg_catalog.lower(new.payment_status) = 'completed' and workflow_action <> 'confirm' then
    raise exception 'Chỉ confirm_payment() được hoàn thành thanh toán.' using errcode = '23514';
  end if;
  if pg_catalog.lower(new.payment_status) = 'rejected' and workflow_action <> 'reject' then
    raise exception 'Chỉ reject_payment() được từ chối thanh toán.' using errcode = '23514';
  end if;
  if pg_catalog.lower(new.payment_status) = 'cancelled' and workflow_action <> 'cancel' then
    raise exception 'Chỉ cancel_payment() được hủy thanh toán.' using errcode = '23514';
  end if;
  if pg_catalog.lower(new.payment_status) not in ('pending', 'completed', 'rejected', 'cancelled') then
    raise exception 'Trạng thái thanh toán không hợp lệ.' using errcode = '23514';
  end if;
  if pg_catalog.lower(new.payment_status) = 'pending'
    and workflow_action <> 'edit'
    and (
      new.customer_id is distinct from old.customer_id
      or new.kiosk_id is distinct from old.kiosk_id
      or new.start_date is distinct from old.start_date
      or new.end_date is distinct from old.end_date
      or new.months is distinct from old.months
      or new.price_per_month is distinct from old.price_per_month
      or new.discount is distinct from old.discount
      or new.discount_reason is distinct from old.discount_reason
      or new.total_amount is distinct from old.total_amount
      or new.payment_method is distinct from old.payment_method
    ) then
    raise exception 'Trường tài chính của thanh toán Pending phải được sửa qua update_pending_payment().'
      using errcode = '23514';
  end if;
  return new;
end;
$function$;
CREATE OR REPLACE FUNCTION private.sync_completed_renewal_kiosk_period()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if coalesce(
    pg_catalog.current_setting('app.payment_workflow_action', true),
    ''
  ) = 'historical_correction' then
    return null;
  end if;

  if old.payment_status is distinct from 'completed' and new.registration_batch_id is null
    and new.payment_status = 'completed'
    and new.start_date is not null
    and new.end_date is not null then
    update public.kiosks
    set status = 'active', end_date = new.end_date
    where id = new.kiosk_id;
  end if;
  return null;
end;
$function$;
-- Keep cached customer counts aligned with the business read model, including legacy writers.
create or replace function private.enforce_business_kiosk_count() returns trigger language plpgsql security definer set search_path='' as $$
begin
 new.total_kiosks:=(select count(*) from public.registered_kiosks where customer_id=new.id);
 return new;
end $$;
revoke all on function private.enforce_business_kiosk_count() from public;
create trigger enforce_business_kiosk_count_trigger before update of total_kiosks on public.customers for each row execute function private.enforce_business_kiosk_count();
update public.customers c set total_kiosks=(select count(*) from public.registered_kiosks k where k.customer_id=c.id)
where total_kiosks is distinct from (select count(*)::integer from public.registered_kiosks k where k.customer_id=c.id);
-- Coupon variant keeps the legacy manual-renewal signature and no-coupon path intact.
create or replace function public.admin_manual_renew_kiosk(kiosk_id_input bigint,months_input integer,start_date_input date,
 base_amount_input numeric,discount_input numeric,discount_reason_input text,payment_method_input text,note_input text,promotion_code_input text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.user_roles%rowtype; prepared jsonb; result jsonb; payment_id_value bigint;
begin
 actor:=private.assert_payment_permission();
 if lower(actor.role)<>'admin' then raise exception 'Chỉ Admin được xác nhận gia hạn thủ công.' using errcode='42501'; end if;
 if payment_method_input not in ('transfer','cash','other') then raise exception 'Phương thức thanh toán không hợp lệ.'; end if;
 if nullif(btrim(promotion_code_input),'') is null then
   return public.admin_manual_renew_kiosk(kiosk_id_input,months_input,start_date_input,base_amount_input,discount_input,discount_reason_input,payment_method_input,note_input);
 end if;
 prepared:=private.prepare_renewal_payment(kiosk_id_input,months_input,promotion_code_input,discount_input,discount_reason_input,note_input,false);
 payment_id_value:=(prepared->'payment'->>'id')::bigint;
 if exists(select 1 from public.payos_orders where payment_id=payment_id_value and reconciliation_required) then raise exception 'Thanh toán cần đối soát trước khi xác nhận.'; end if;
 perform set_config('app.payment_workflow_action','edit',true);
 update public.payments set payment_method=payment_method_input where id=payment_id_value;
 result:=private.confirm_crm_payment_from_payos(payment_id_value,'Admin xác nhận đã nhận tiền: '||coalesce(note_input,''));
 update public.payos_orders set active_slot=null where payment_id=payment_id_value and active_slot is true;
 return result||jsonb_build_object('period',jsonb_build_object('start_date',result->'payment'->'start_date','end_date',result->'payment'->'end_date'),'payment_source','admin_manual');
end $$;
revoke all on function public.admin_manual_renew_kiosk(bigint,integer,date,numeric,numeric,text,text,text,text) from public,anon;
grant execute on function public.admin_manual_renew_kiosk(bigint,integer,date,numeric,numeric,text,text,text,text) to authenticated;
notify pgrst, 'reload schema';
commit;
