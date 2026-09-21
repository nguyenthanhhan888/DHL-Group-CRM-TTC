-- Round 2: keep organization settings private while allowing status read models
-- to consume the one public-safe warning-days value.
begin;

create or replace function public.get_kiosk_status_data(
  p_search text default null, p_status text default null, p_business_type_id bigint default null,
  p_sort_by text default 'created_at', p_sort_direction text default 'desc',
  p_page integer default 1, p_page_size integer default 12
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare warning_days integer := public.get_status_warning_days();
  today_date date := (now() at time zone 'Asia/Ho_Chi_Minh')::date; result jsonb;
begin
  if not (public.has_user_permission('kiosks') or public.has_user_permission('kiosk-detail')) then
    raise exception 'Không có quyền xem Kiosk.' using errcode='42501';
  end if;
  if p_page < 1 or p_page_size not in (12,24,48) then raise exception 'Phân trang Kiosk không hợp lệ.'; end if;
  if lower(coalesce(p_sort_direction,'desc')) not in ('asc','desc') then raise exception 'Chiều sắp xếp không hợp lệ.'; end if;
  with classified as (
    select k.*, public.resolve_kiosk_status(k.status,k.end_date,warning_days,today_date) derived_status,
      c.facebook_name customer_name,c.facebook_id customer_facebook_id,c.phone customer_phone,c.address customer_address,
      c.status customer_stored_status,c.total_paid customer_total_paid,c.total_kiosks customer_total_kiosks,c.note customer_note,
      ca.name category_name,bt.name business_type_name,bt.price_per_month
    from public.registered_kiosks k left join public.customers c on c.id=k.customer_id
    left join public.categories ca on ca.id=k.category_id left join public.business_types bt on bt.id=k.business_type_id
  ), filtered as (
    select * from classified where (p_business_type_id is null or business_type_id=p_business_type_id)
      and (p_status is null or p_status='' or
        (lower(p_status)='active' and derived_status in ('active','warning')) or
        (lower(p_status)<>'active' and derived_status=lower(p_status)))
      and (p_search is null or btrim(p_search)='' or facebook_name ilike '%'||btrim(p_search)||'%'
        or facebook_id ilike '%'||btrim(p_search)||'%' or derived_status ilike '%'||btrim(p_search)||'%'
        or business_type_name ilike '%'||btrim(p_search)||'%')
  ), counted as (select count(*)::bigint total_rows from filtered), groups as (
    select coalesce(jsonb_object_agg(derived_status,amount),'{}'::jsonb) data
    from (select derived_status,count(*)::bigint amount from filtered group by derived_status) grouped
  ), paged as (
    select * from filtered order by
      case when p_sort_by='end_date' and lower(p_sort_direction)='asc' then end_date end asc nulls last,
      case when p_sort_by='end_date' and lower(p_sort_direction)='desc' then end_date end desc nulls last,
      case when p_sort_by='facebook_name' and lower(p_sort_direction)='asc' then facebook_name end asc nulls last,
      case when p_sort_by='facebook_name' and lower(p_sort_direction)='desc' then facebook_name end desc nulls last,
      case when p_sort_by='status' and lower(p_sort_direction)='asc' then derived_status end asc,
      case when p_sort_by='status' and lower(p_sort_direction)='desc' then derived_status end desc,
      case when coalesce(p_sort_by,'created_at')='created_at' and lower(p_sort_direction)='asc' then created_at end asc,
      created_at desc,id desc limit p_page_size offset (p_page-1)*p_page_size
  ), rows as (
    select coalesce(jsonb_agg(to_jsonb(paged)-'derived_status'-'customer_name'-'customer_facebook_id'-'customer_phone'
      -'customer_address'-'customer_stored_status'-'customer_total_paid'-'customer_total_kiosks'-'customer_note'
      -'category_name'-'business_type_name'-'price_per_month'||jsonb_build_object(
        'status',derived_status,'stored_status',status,
        'customers',jsonb_build_object('id',customer_id,'facebook_name',customer_name,'facebook_id',customer_facebook_id,
          'phone',customer_phone,'address',customer_address,'status',customer_stored_status,'total_paid',customer_total_paid,
          'total_kiosks',customer_total_kiosks,'note',customer_note),
        'categories',jsonb_build_object('name',category_name),
        'business_types',jsonb_build_object('name',business_type_name,'price_per_month',price_per_month)
      ) order by case when p_status='warning' then end_date end asc nulls last,
        case when p_status='expired' then end_date end desc nulls last,id desc),'[]'::jsonb) data from paged
  ) select jsonb_build_object('rows',r.data,'totalRows',c.total_rows,'statusCounts',g.data,
      'warningDays',warning_days,'reportDate',today_date)
    into result from rows r cross join counted c cross join groups g;
  return coalesce(result,'{}'::jsonb);
end;
$$;

create or replace function public.get_customer_status_data(
  p_search text default null,p_customer_status text default null,p_kiosk_status text default null,p_customer_id bigint default null,
  p_sort_by text default 'created_at',p_sort_direction text default 'desc',p_page integer default 1,p_page_size integer default 10
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare warning_days integer := public.get_status_warning_days();
  today_date date := (now() at time zone 'Asia/Ho_Chi_Minh')::date; result jsonb;
begin
  if not (public.has_user_permission('customers') or public.has_user_permission('customer-detail')) then
    raise exception 'Không có quyền xem khách hàng.' using errcode='42501';
  end if;
  if p_page<1 or p_page_size not in(10,25,50) then raise exception 'Phân trang khách hàng không hợp lệ.'; end if;
  with kiosk_states as (
    select k.customer_id,k.id,public.resolve_kiosk_status(k.status,k.end_date,warning_days,today_date) derived_status,k.end_date
    from public.registered_kiosks k
  ), classified as (
    select c.*,public.resolve_customer_status(c.status,coalesce(array_agg(ks.derived_status) filter(where ks.id is not null),'{}'::text[])) derived_status,
      coalesce(count(ks.id),0)::bigint actual_total_kiosks,min(ks.end_date) filter(where ks.derived_status='warning') nearest_warning_end_date,
      max(ks.end_date) filter(where ks.derived_status='expired') latest_expired_end_date,
      coalesce(bool_or(ks.derived_status=lower(p_kiosk_status)),false) has_requested_kiosk_status
    from public.customers c left join kiosk_states ks on ks.customer_id=c.id where c.archived_at is null group by c.id
  ), filtered as (
    select * from classified where (p_customer_id is null or id=p_customer_id)
      and (p_customer_status is null or p_customer_status='' or derived_status=lower(p_customer_status))
      and (p_kiosk_status is null or p_kiosk_status='' or has_requested_kiosk_status)
      and (p_search is null or btrim(p_search)='' or phone ilike '%'||btrim(p_search)||'%'
        or facebook_id ilike '%'||btrim(p_search)||'%' or facebook_name ilike '%'||btrim(p_search)||'%')
  ), counted as(select count(*)::bigint total_rows from filtered), groups as(
    select coalesce(jsonb_object_agg(derived_status,amount),'{}'::jsonb) data
    from(select derived_status,count(*)::bigint amount from filtered group by derived_status) grouped
  ), paged as (
    select * from filtered order by case when p_kiosk_status='warning' then nearest_warning_end_date end asc nulls last,
      case when p_kiosk_status='expired' then latest_expired_end_date end desc nulls last,
      case when p_sort_by='facebook_name' and lower(p_sort_direction)='asc' then facebook_name end asc,
      case when p_sort_by='facebook_name' and lower(p_sort_direction)='desc' then facebook_name end desc,
      case when p_sort_by='total_kiosks' and lower(p_sort_direction)='asc' then actual_total_kiosks end asc,
      case when p_sort_by='total_kiosks' and lower(p_sort_direction)='desc' then actual_total_kiosks end desc,
      case when coalesce(p_sort_by,'created_at')='created_at' and lower(p_sort_direction)='asc' then created_at end asc,
      created_at desc,id desc limit p_page_size offset(p_page-1)*p_page_size
  ), rows as(select coalesce(jsonb_agg(to_jsonb(paged)-'has_requested_kiosk_status'||jsonb_build_object(
      'stored_status',status,'status',derived_status,'total_kiosks',actual_total_kiosks)),'[]'::jsonb) data from paged)
  select jsonb_build_object('rows',r.data,'totalRows',c.total_rows,'statusCounts',g.data,'warningDays',warning_days,'reportDate',today_date)
    into result from rows r cross join counted c cross join groups g;
  return coalesce(result,'{}'::jsonb);
end;
$$;

revoke all on function public.get_kiosk_status_data(text,text,bigint,text,text,integer,integer) from public,anon;
revoke all on function public.get_customer_status_data(text,text,text,bigint,text,text,integer,integer) from public,anon;
grant execute on function public.get_kiosk_status_data(text,text,bigint,text,text,integer,integer) to authenticated;
grant execute on function public.get_customer_status_data(text,text,text,bigint,text,text,integer,integer) to authenticated;

commit;
