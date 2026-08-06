create or replace function public.get_dashboard_data(
  p_year integer default extract(year from (now() at time zone 'Asia/Ho_Chi_Minh'))::integer,
  p_month integer default extract(month from (now() at time zone 'Asia/Ho_Chi_Minh'))::integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
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
  next_month_start := month_start + interval '1 month';
  year_start := make_timestamptz(p_year, 1, 1, 0, 0, 0, 'Asia/Ho_Chi_Minh');
  next_year_start := year_start + interval '1 year';

  with
  customer_kpis as (
    select count(*)::bigint as total_customers
    from public.customers
  ),
  kiosk_kpis as (
    select
      count(*)::bigint as total_kiosks,
      count(*) filter (where lower(status) = 'active')::bigint as active_kiosks,
      count(*) filter (where lower(status) = 'pending')::bigint as pending_kiosks,
      count(*) filter (where lower(status) = 'expired')::bigint as expired_kiosks,
      count(*) filter (
        where lower(status) = 'active'
          and end_date >= today_date
          and end_date <= today_date + warning_days
      )::bigint as expiring_soon
    from public.kiosks
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
    from public.payments
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
      left join public.payments p
        on lower(p.payment_status) = 'completed'
        and p.confirmed_at is not null
        and p.confirmed_at >= make_timestamptz(p_year, month_number, 1, 0, 0, 0, 'Asia/Ho_Chi_Minh')
        and p.confirmed_at < make_timestamptz(p_year, month_number, 1, 0, 0, 0, 'Asia/Ho_Chi_Minh') + interval '1 month'
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
      from public.kiosks k
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
      from public.kiosks k
      left join public.customers c on c.id = k.customer_id
      where lower(k.status) = 'active'
        and k.end_date >= today_date
        and k.end_date <= today_date + warning_days
      order by k.end_date, k.id
      limit 24
    ) item
  ),
  recent_customers as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', item.id,
          'facebook_name', item.facebook_name,
          'created_at', item.created_at
        )
        order by item.created_at desc, item.id desc
      ),
      '[]'::jsonb
    ) as data
    from (
      select id, facebook_name, created_at
      from public.customers
      order by created_at desc, id desc
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
      'recentCustomers', coalesce(rc.data, '[]'::jsonb)
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
  cross join recent_customers rc;

  return coalesce(result, '{}'::jsonb);
end;
$function$;

revoke all on function public.get_dashboard_data(integer, integer) from public;
revoke all on function public.get_dashboard_data(integer, integer) from anon;
grant execute on function public.get_dashboard_data(integer, integer) to authenticated;
