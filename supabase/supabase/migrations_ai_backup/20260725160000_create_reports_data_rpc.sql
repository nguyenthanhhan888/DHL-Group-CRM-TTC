create or replace function public.get_reports_data(
  p_report_type text default 'overview',
  p_start_date date default null,
  p_end_date date default null,
  p_customer_id bigint default null,
  p_kiosk_id bigint default null,
  p_category_id bigint default null,
  p_business_type_id bigint default null,
  p_payment_status text default null,
  p_kiosk_status text default null,
  p_sort_by text default null,
  p_sort_direction text default 'desc',
  p_page integer default 1,
  p_page_size integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
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

  select greatest(
    coalesce(case when s.value ~ '^\d+$' then s.value::integer end, 30),
    0
  )
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
      from public.payments p
      left join public.kiosks k on k.id = p.kiosk_id
      where lower(p.payment_status) = 'completed'
        and p.confirmed_at is not null
        and (start_at is null or p.confirmed_at >= start_at)
        and (end_at is null or p.confirmed_at < end_at)
        and (p_customer_id is null or p.customer_id = p_customer_id)
        and (p_kiosk_id is null or p.kiosk_id = p_kiosk_id)
        and (p_category_id is null or k.category_id = p_category_id)
        and (p_business_type_id is null or k.business_type_id = p_business_type_id)
        and (p_payment_status is null or lower(p.payment_status) = lower(p_payment_status))
        and (p_kiosk_status is null or lower(k.status) = lower(p_kiosk_status))
    ),
    operational_payments as (
      select p.*
      from public.payments p
      left join public.kiosks k on k.id = p.kiosk_id
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
        and (p_kiosk_status is null or lower(k.status) = lower(p_kiosk_status))
    ),
    filtered_kiosks as (
      select k.*
      from public.kiosks k
      where (p_customer_id is null or k.customer_id = p_customer_id)
        and (p_kiosk_id is null or k.id = p_kiosk_id)
        and (p_category_id is null or k.category_id = p_category_id)
        and (p_business_type_id is null or k.business_type_id = p_business_type_id)
        and (
          p_kiosk_status is null
          or (lower(p_kiosk_status) = 'expiring_soon'
            and lower(k.status) = 'active'
            and k.end_date between today_date and today_date + warning_days)
          or lower(k.status) = lower(p_kiosk_status)
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
        count(*) filter (where lower(status) = 'active')::bigint as active_kiosks,
        count(*) filter (where lower(status) = 'pending')::bigint as pending_kiosks,
        count(*) filter (where lower(status) = 'expired')::bigint as expired_kiosks,
        count(*) filter (where lower(status) = 'suspended')::bigint as suspended_kiosks,
        count(*) filter (
          where lower(status) = 'active'
            and end_date between today_date and today_date + warning_days
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
            when lower(k.status) = 'pending' then 'pending'
            when lower(k.status) = 'expired' then 'expired'
            when lower(k.status) = 'active'
              and k.end_date between today_date and today_date + warning_days then 'warning'
            else lower(coalesce(k.status, 'unknown'))
          end as "derivedStatus",
          k.end_date - today_date as "daysLeft",
          case
            when lower(k.status) = 'pending' then 0
            when lower(k.status) = 'expired' then 1
            else 2
          end as "sortPriority"
        from filtered_kiosks k
        left join public.customers c on c.id = k.customer_id
        where lower(k.status) in ('pending', 'expired')
          or (lower(k.status) = 'active'
            and k.end_date between today_date and today_date + warning_days)
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
      from public.payments p
      left join public.customers c on c.id = p.customer_id
      left join public.kiosks k on k.id = p.kiosk_id
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
        and (p_kiosk_status is null or lower(k.status) = lower(p_kiosk_status))
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
        lower(coalesce(k.status, 'unknown')) as status,
        coalesce(k.total_paid, 0) as total_paid,
        c.facebook_name as customer_name,
        c.phone,
        ca.name as category_name,
        bt.name as business_type_name,
        case
          when lower(k.status) = 'active'
            and k.end_date between today_date and today_date + warning_days then true
          else false
        end as expiring_soon,
        k.end_date - today_date as days_left
      from public.kiosks k
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
            and lower(k.status) = 'active'
            and k.end_date between today_date and today_date + warning_days)
          or lower(k.status) = lower(p_kiosk_status)
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
          status,
          count(*)::bigint as "kioskCount",
          coalesce(sum(total_paid), 0) as "totalPaid"
        from filtered
        group by status
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
        coalesce(ka.expired_kiosks, 0) as expired_kiosks,
        coalesce(pa.total_paid, 0) as total_paid,
        pa.latest_completed_payment,
        ka.latest_kiosk_end_date
      from public.customers c
      left join lateral (
        select
          count(*)::bigint as total_kiosks,
          count(*) filter (where lower(k.status) = 'active')::bigint as active_kiosks,
          count(*) filter (where lower(k.status) = 'expired')::bigint as expired_kiosks,
          max(k.end_date) as latest_kiosk_end_date
        from public.kiosks k
        where k.customer_id = c.id
          and (p_kiosk_id is null or k.id = p_kiosk_id)
          and (p_category_id is null or k.category_id = p_category_id)
          and (p_business_type_id is null or k.business_type_id = p_business_type_id)
          and (
            p_kiosk_status is null
            or (lower(p_kiosk_status) = 'expiring_soon'
              and lower(k.status) = 'active'
              and k.end_date between today_date and today_date + warning_days)
            or lower(k.status) = lower(p_kiosk_status)
          )
      ) ka on true
      left join lateral (
        select
          coalesce(sum(p.total_amount), 0) as total_paid,
          max(p.confirmed_at) as latest_completed_payment
        from public.payments p
        left join public.kiosks pk on pk.id = p.kiosk_id
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
          'status', lower(coalesce(status, 'unknown')),
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
          from public.payments p
          where p.customer_id = c.id
            and lower(p.payment_status) = 'completed'
            and p.confirmed_at is not null
        ), 0) as actual_paid
      from public.customers c
      left join public.kiosks k on k.customer_id = c.id
      group by c.id
    ),
    duplicate_kiosk_ids as (
      select trim(facebook_id) as facebook_id
      from public.kiosks
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
      from public.payments p
      left join public.customers c on c.id = p.customer_id
      left join public.kiosks k on k.id = p.kiosk_id
      where lower(p.payment_status) = 'completed' and p.confirmed_at is null

      union all
      select 'payment_without_customer', 'Thanh toán thiếu khách hàng', 'payment',
        p.id::text, p.id, p.customer_id, p.kiosk_id, 'Không tên',
        coalesce(k.facebook_name, 'Không tên'), lower(coalesce(p.payment_status, 'unknown')),
        coalesce(p.total_amount, 0), coalesce(p.confirmed_at, p.created_at)
      from public.payments p
      left join public.customers c on c.id = p.customer_id
      left join public.kiosks k on k.id = p.kiosk_id
      where p.customer_id is null or c.id is null

      union all
      select 'payment_without_kiosk', 'Thanh toán thiếu Kiosk', 'payment',
        p.id::text, p.id, p.customer_id, p.kiosk_id,
        coalesce(c.facebook_name, 'Không tên'), 'Không tên',
        lower(coalesce(p.payment_status, 'unknown')), coalesce(p.total_amount, 0),
        coalesce(p.confirmed_at, p.created_at)
      from public.payments p
      left join public.customers c on c.id = p.customer_id
      left join public.kiosks k on k.id = p.kiosk_id
      where p.kiosk_id is null or k.id is null

      union all
      select 'kiosk_without_customer', 'Kiosk thiếu khách hàng', 'kiosk',
        k.id::text, null::bigint, k.customer_id, k.id, 'Không tên',
        coalesce(k.facebook_name, 'Không tên'), lower(coalesce(k.status, 'unknown')),
        0::numeric, k.created_at
      from public.kiosks k
      left join public.customers c on c.id = k.customer_id
      where k.customer_id is null or c.id is null

      union all
      select 'kiosk_without_facebook_id', 'Kiosk thiếu Facebook ID', 'kiosk',
        k.id::text, null::bigint, k.customer_id, k.id,
        coalesce(c.facebook_name, 'Không tên'), coalesce(k.facebook_name, 'Không tên'),
        lower(coalesce(k.status, 'unknown')), 0::numeric, k.created_at
      from public.kiosks k
      left join public.customers c on c.id = k.customer_id
      where nullif(trim(k.facebook_id), '') is null

      union all
      select 'duplicate_facebook_id', 'Facebook ID Kiosk bị trùng', 'kiosk',
        k.id::text, null::bigint, k.customer_id, k.id,
        coalesce(c.facebook_name, 'Không tên'), coalesce(k.facebook_name, 'Không tên'),
        lower(coalesce(k.status, 'unknown')), 0::numeric, k.created_at
      from public.kiosks k
      join duplicate_kiosk_ids d on d.facebook_id = trim(k.facebook_id)
      left join public.customers c on c.id = k.customer_id

      union all
      select 'kiosk_without_end_date', 'Kiosk thiếu end_date', 'kiosk',
        k.id::text, null::bigint, k.customer_id, k.id,
        coalesce(c.facebook_name, 'Không tên'), coalesce(k.facebook_name, 'Không tên'),
        lower(coalesce(k.status, 'unknown')), 0::numeric, k.created_at
      from public.kiosks k
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
      from public.payments p
      left join public.customers c on c.id = p.customer_id
      left join public.kiosks k on k.id = p.kiosk_id
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
            select 1 from public.kiosks fk
            where fk.id = i.kiosk_id and fk.category_id = p_category_id
          )
        )
        and (
          p_business_type_id is null
          or exists (
            select 1 from public.kiosks fk
            where fk.id = i.kiosk_id and fk.business_type_id = p_business_type_id
          )
        )
        and (p_payment_status is null or i.status = lower(p_payment_status))
        and (
          p_kiosk_status is null
          or exists (
            select 1
            from public.kiosks fk
            where fk.id = i.kiosk_id
              and (
                (lower(p_kiosk_status) = 'expiring_soon'
                  and lower(fk.status) = 'active'
                  and fk.end_date between today_date and today_date + warning_days)
                or lower(fk.status) = lower(p_kiosk_status)
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
        count(distinct k.id) filter (where lower(k.status) = 'active')::bigint as active_kiosks,
        count(distinct k.id) filter (where lower(k.status) = 'pending')::bigint as pending_kiosks,
        count(distinct k.id) filter (where lower(k.status) = 'expired')::bigint as expired_kiosks,
        coalesce(sum(p.total_amount), 0) as total_revenue,
        count(distinct p.id)::bigint as completed_payments
      from public.categories ca
      left join public.business_types bt on bt.category_id = ca.id
      left join public.kiosks k
        on k.business_type_id = bt.id
        and (p_customer_id is null or k.customer_id = p_customer_id)
        and (p_kiosk_id is null or k.id = p_kiosk_id)
        and (
          p_kiosk_status is null
          or (lower(p_kiosk_status) = 'expiring_soon'
            and lower(k.status) = 'active'
            and k.end_date between today_date and today_date + warning_days)
          or lower(k.status) = lower(p_kiosk_status)
        )
      left join public.payments p
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

  return coalesce(result, jsonb_build_object(
    'tab', report_type,
    'summary', '{}'::jsonb,
    'rows', '[]'::jsonb,
    'pagination', jsonb_build_object(
      'page', p_page, 'pageSize', p_page_size, 'totalRows', 0, 'totalPages', 0
    )
  ));
end;
$function$;

revoke all on function public.get_reports_data(
  text, date, date, bigint, bigint, bigint, bigint, text, text, text, text, integer, integer
) from public;
revoke all on function public.get_reports_data(
  text, date, date, bigint, bigint, bigint, bigint, text, text, text, text, integer, integer
) from anon;
grant execute on function public.get_reports_data(
  text, date, date, bigint, bigint, bigint, bigint, text, text, text, text, integer, integer
) to authenticated;
