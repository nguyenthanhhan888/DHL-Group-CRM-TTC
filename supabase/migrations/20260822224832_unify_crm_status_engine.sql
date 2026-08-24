-- One status contract for CRM reads. Administrative states are preserved;
-- only active/warning/expired are derived from the Vietnam calendar date.
create or replace function public.resolve_kiosk_status(
  stored_status text,
  end_date_value date,
  warning_days_value integer,
  today_value date
)
returns text
language sql
immutable
security invoker
set search_path = ''
as $function$
  select case
    when lower(coalesce(stored_status, 'inactive')) not in ('active', 'warning', 'expired')
      then lower(coalesce(stored_status, 'inactive'))
    when end_date_value is null then lower(coalesce(stored_status, 'inactive'))
    when end_date_value < today_value then 'expired'
    when end_date_value <= today_value + greatest(coalesce(warning_days_value, 30), 0) then 'warning'
    else 'active'
  end
$function$;

create or replace function public.resolve_customer_status(
  stored_status text,
  kiosk_statuses text[]
)
returns text
language sql
immutable
security invoker
set search_path = ''
as $function$
  select case
    when lower(coalesce(stored_status, 'inactive')) <> 'active'
      then lower(coalesce(stored_status, 'inactive'))
    when coalesce(cardinality(kiosk_statuses), 0) = 0 then 'active'
    when 'warning' = any(kiosk_statuses) then 'warning'
    when 'active' = any(kiosk_statuses) then 'active'
    when 'pending' = any(kiosk_statuses) then 'pending'
    when 'suspended' = any(kiosk_statuses) then 'suspended'
    when 'expired' = any(kiosk_statuses) then 'expired'
    else 'inactive'
  end
$function$;

revoke all on function public.resolve_kiosk_status(text, date, integer, date) from public, anon;
revoke all on function public.resolve_customer_status(text, text[]) from public, anon;
grant execute on function public.resolve_kiosk_status(text, date, integer, date) to authenticated;
grant execute on function public.resolve_customer_status(text, text[]) to authenticated;

create or replace function public.get_kiosk_status_data(
  p_search text default null,
  p_status text default null,
  p_business_type_id bigint default null,
  p_sort_by text default 'created_at',
  p_sort_direction text default 'desc',
  p_page integer default 1,
  p_page_size integer default 12
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
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

  select greatest(coalesce(case when s.value ~ '^\d+$' then s.value::integer end, 30), 0)
  into warning_days from public.settings s where s.key = 'warning_days';
  warning_days := coalesce(warning_days, 30);

  with classified as (
    select k.*,
      public.resolve_kiosk_status(k.status, k.end_date, warning_days, today_date) as derived_status,
      c.facebook_name as customer_name, c.facebook_id as customer_facebook_id,
      c.phone as customer_phone, c.address as customer_address, c.status as customer_stored_status,
      c.total_paid as customer_total_paid, c.total_kiosks as customer_total_kiosks, c.note as customer_note,
      ca.name as category_name, bt.name as business_type_name, bt.price_per_month
    from public.kiosks k
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

revoke all on function public.get_kiosk_status_data(text,text,bigint,text,text,integer,integer) from public, anon;
grant execute on function public.get_kiosk_status_data(text,text,bigint,text,text,integer,integer) to authenticated;

create or replace function public.get_customer_status_data(
  p_search text default null,
  p_customer_status text default null,
  p_kiosk_status text default null,
  p_customer_id bigint default null,
  p_sort_by text default 'created_at',
  p_sort_direction text default 'desc',
  p_page integer default 1,
  p_page_size integer default 10
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  warning_days integer;
  today_date date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  result jsonb;
begin
  if p_page < 1 or p_page_size not in (10, 25, 50) then raise exception 'Phân trang khách hàng không hợp lệ.'; end if;
  select greatest(coalesce(case when s.value ~ '^\d+$' then s.value::integer end, 30), 0)
  into warning_days from public.settings s where s.key = 'warning_days';
  warning_days := coalesce(warning_days, 30);

  with kiosk_states as (
    select k.customer_id, k.id,
      public.resolve_kiosk_status(k.status, k.end_date, warning_days, today_date) as derived_status,
      k.end_date
    from public.kiosks k
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

revoke all on function public.get_customer_status_data(text,text,text,bigint,text,text,integer,integer) from public, anon;
grant execute on function public.get_customer_status_data(text,text,text,bigint,text,text,integer,integer) to authenticated;

-- Make the effective report RPC use the shared classifier without copying or
-- editing its already-applied migration. The guards fail if its known shape changed.
do $migration$
declare
  target regprocedure := 'public.get_reports_data(text,date,date,bigint,bigint,bigint,bigint,text,text,text,text,integer,integer)'::regprocedure;
  definition text;
  changed text;
begin
  select pg_catalog.pg_get_functiondef(target) into definition;
  changed := replace(definition,
    'lower(coalesce(k.status, ''unknown'')) as status',
    'public.resolve_kiosk_status(k.status, k.end_date, warning_days, today_date) as status');
  changed := regexp_replace(changed,
    'lower\(k\.status\) in \(''active'', ''warning''\)\s+and k\.end_date between today_date and today_date \+ warning_days',
    'public.resolve_kiosk_status(k.status, k.end_date, warning_days, today_date) = ''warning''', 'g');
  changed := regexp_replace(changed,
    'lower\(fk\.status\) in \(''active'', ''warning''\)\s+and fk\.end_date between today_date and today_date \+ warning_days',
    'public.resolve_kiosk_status(fk.status, fk.end_date, warning_days, today_date) = ''warning''', 'g');
  changed := regexp_replace(changed,
    'lower\(status\) in \(''active'', ''warning''\)\s+and end_date between today_date and today_date \+ warning_days',
    'public.resolve_kiosk_status(status, end_date, warning_days, today_date) = ''warning''', 'g');
  changed := replace(changed, 'lower(k.status) = lower(p_kiosk_status)',
    'public.resolve_kiosk_status(k.status, k.end_date, warning_days, today_date) = case when lower(p_kiosk_status) = ''expiring_soon'' then ''warning'' else lower(p_kiosk_status) end');
  changed := replace(changed, 'lower(fk.status) = lower(p_kiosk_status)',
    'public.resolve_kiosk_status(fk.status, fk.end_date, warning_days, today_date) = case when lower(p_kiosk_status) = ''expiring_soon'' then ''warning'' else lower(p_kiosk_status) end');
  changed := replace(changed, 'lower(k.status) = ''active''',
    'public.resolve_kiosk_status(k.status, k.end_date, warning_days, today_date) = ''active''');
  changed := replace(changed, 'lower(k.status) = ''expired''',
    'public.resolve_kiosk_status(k.status, k.end_date, warning_days, today_date) = ''expired''');
  changed := replace(changed, 'lower(k.status) = ''pending''',
    'public.resolve_kiosk_status(k.status, k.end_date, warning_days, today_date) = ''pending''');
  changed := replace(changed, 'lower(k.status) = ''suspended''',
    'public.resolve_kiosk_status(k.status, k.end_date, warning_days, today_date) = ''suspended''');
  changed := replace(changed, 'count(*) filter (where lower(status) = ''active'')',
    'count(*) filter (where public.resolve_kiosk_status(status, end_date, warning_days, today_date) = ''active'')');
  changed := replace(changed, 'count(*) filter (where lower(status) = ''pending'')',
    'count(*) filter (where public.resolve_kiosk_status(status, end_date, warning_days, today_date) = ''pending'')');
  changed := replace(changed, 'count(*) filter (where lower(status) = ''expired'')',
    'count(*) filter (where public.resolve_kiosk_status(status, end_date, warning_days, today_date) = ''expired'')');
  changed := replace(changed, 'count(*) filter (where lower(status) = ''suspended'')',
    'count(*) filter (where public.resolve_kiosk_status(status, end_date, warning_days, today_date) = ''suspended'')');
  changed := replace(changed,
    'coalesce(ka.expired_kiosks, 0) as expired_kiosks,',
    'coalesce(ka.expired_kiosks, 0) as expired_kiosks, public.resolve_customer_status(c.status, coalesce(ka.kiosk_statuses, ''{}''::text[])) as derived_status,');
  changed := regexp_replace(changed,
    'count\(\*\) filter \(where public\.resolve_kiosk_status\(k\.status, k\.end_date, warning_days, today_date\) = ''expired''\)::bigint as expired_kiosks,\s+max\(k\.end_date\) as latest_kiosk_end_date',
    'count(*) filter (where public.resolve_kiosk_status(k.status, k.end_date, warning_days, today_date) = ''expired'')::bigint as expired_kiosks, array_agg(public.resolve_kiosk_status(k.status, k.end_date, warning_days, today_date)) filter (where k.id is not null) as kiosk_statuses, max(k.end_date) as latest_kiosk_end_date', 'g');
  changed := replace(changed, '''status'', lower(coalesce(status, ''unknown''))',
    '''status'', derived_status, ''storedStatus'', lower(coalesce(status, ''unknown''))');
  if changed = definition or changed not like '%public.resolve_kiosk_status%' then
    raise exception 'Effective reports RPC did not match the expected status expressions.';
  end if;
  execute changed;
end
$migration$;

revoke all on function public.get_reports_data(text,date,date,bigint,bigint,bigint,bigint,text,text,text,text,integer,integer) from public, anon;
grant execute on function public.get_reports_data(text,date,date,bigint,bigint,bigint,bigint,text,text,text,text,integer,integer) to authenticated;

-- Dashboard retains its revenue and recent-registration behavior; only Kiosk
-- classification is replaced with the same shared status contract.
do $migration$
declare
  target regprocedure := 'public.get_dashboard_data(integer,integer)'::regprocedure;
  definition text;
  changed text;
begin
  select pg_catalog.pg_get_functiondef(target) into definition;
  changed := definition;
  changed := replace(changed, 'count(*) filter (where lower(status) = ''active'')',
    'count(*) filter (where public.resolve_kiosk_status(status, end_date, warning_days, today_date) = ''active'')');
  changed := replace(changed, 'count(*) filter (where lower(status) = ''pending'')',
    'count(*) filter (where public.resolve_kiosk_status(status, end_date, warning_days, today_date) = ''pending'')');
  changed := replace(changed, 'count(*) filter (where lower(status) = ''expired'')',
    'count(*) filter (where public.resolve_kiosk_status(status, end_date, warning_days, today_date) = ''expired'')');
  changed := regexp_replace(changed,
    'where lower\(status\) = ''active''\s+and end_date >= today_date\s+and end_date <= today_date \+ warning_days',
    'where public.resolve_kiosk_status(status, end_date, warning_days, today_date) = ''warning''', 'g');
  changed := regexp_replace(changed,
    'where lower\(k\.status\) = ''active''\s+and k\.end_date >= today_date\s+and k\.end_date <= today_date \+ warning_days',
    'where public.resolve_kiosk_status(k.status, k.end_date, warning_days, today_date) = ''warning''', 'g');
  changed := regexp_replace(changed,
    '(order by k\.end_date, k\.id)\s+limit 24', '\1', 'g');
  if changed = definition or changed not like '%public.resolve_kiosk_status%' then
    raise exception 'Effective dashboard RPC did not match the expected status expressions.';
  end if;
  execute changed;
end
$migration$;

revoke all on function public.get_dashboard_data(integer,integer) from public, anon;
grant execute on function public.get_dashboard_data(integer,integer) to authenticated;
