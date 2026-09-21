-- Safe runtime cleanup for future provisional registration customers.
-- Historical customers are not marked or bulk changed by this migration.
begin;

create or replace function private.archive_cancelled_registration_orphan()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare batch_record public.registration_batches%rowtype;
begin
  if new.status <> 'cancelled' or old.status = 'cancelled' or new.registration_batch_id is null then return new; end if;
  select * into batch_record from public.registration_batches where id=new.registration_batch_id for update;
  if batch_record.provisional_customer_id is null or batch_record.provisional_customer_id<>batch_record.customer_id then return new; end if;
  if exists(select 1 from public.registration_requests r where r.registration_batch_id=batch_record.id and r.status<>'cancelled') then return new; end if;
  if exists(select 1 from public.payments p where p.customer_id=batch_record.customer_id and p.payment_status='completed') then return new; end if;
  if exists(select 1 from public.registration_requests r where r.customer_id=batch_record.customer_id and r.registration_batch_id is distinct from batch_record.id) then return new; end if;
  if exists(select 1 from public.kiosks k where k.customer_id=batch_record.customer_id and not exists(
    select 1 from public.registration_batch_items i where i.batch_id=batch_record.id and i.kiosk_id=k.id
  )) then return new; end if;
  update public.customers set status='inactive',archived_at=coalesce(archived_at,now()),
    archived_reason='cancelled_unpaid_registration:'||batch_record.id where id=batch_record.customer_id;
  return new;
end;
$$;
revoke all on function private.archive_cancelled_registration_orphan() from public;
drop trigger if exists registration_request_archive_cancelled_orphan on public.registration_requests;
create trigger registration_request_archive_cancelled_orphan after update of status on public.registration_requests
for each row execute function private.archive_cancelled_registration_orphan();

create or replace function public.get_customer_status_data(
  p_search text default null,p_customer_status text default null,p_kiosk_status text default null,p_customer_id bigint default null,
  p_sort_by text default 'created_at',p_sort_direction text default 'desc',p_page integer default 1,p_page_size integer default 10
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare warning_days integer; today_date date:=(now() at time zone 'Asia/Ho_Chi_Minh')::date; result jsonb;
begin
  if p_page<1 or p_page_size not in(10,25,50) then raise exception 'Phân trang khách hàng không hợp lệ.'; end if;
  select greatest(coalesce(case when s.value~'^\d+$' then s.value::integer end,30),0) into warning_days from public.settings s where s.key='warning_days';
  warning_days:=coalesce(warning_days,30);
  with kiosk_states as (
    select k.customer_id,k.id,public.resolve_kiosk_status(k.status,k.end_date,warning_days,today_date) derived_status,k.end_date from public.registered_kiosks k
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
      and (p_search is null or btrim(p_search)='' or phone ilike '%'||btrim(p_search)||'%' or facebook_id ilike '%'||btrim(p_search)||'%' or facebook_name ilike '%'||btrim(p_search)||'%')
  ), counted as(select count(*)::bigint total_rows from filtered), groups as(
    select coalesce(jsonb_object_agg(derived_status,amount),'{}'::jsonb) data from(select derived_status,count(*)::bigint amount from filtered group by derived_status) grouped
  ), paged as (
    select * from filtered order by case when p_kiosk_status='warning' then nearest_warning_end_date end asc nulls last,
      case when p_kiosk_status='expired' then latest_expired_end_date end desc nulls last,
      case when p_sort_by='facebook_name' and lower(p_sort_direction)='asc' then facebook_name end asc,
      case when p_sort_by='facebook_name' and lower(p_sort_direction)='desc' then facebook_name end desc,
      case when p_sort_by='total_kiosks' and lower(p_sort_direction)='asc' then actual_total_kiosks end asc,
      case when p_sort_by='total_kiosks' and lower(p_sort_direction)='desc' then actual_total_kiosks end desc,
      case when coalesce(p_sort_by,'created_at')='created_at' and lower(p_sort_direction)='asc' then created_at end asc,created_at desc,id desc
    limit p_page_size offset(p_page-1)*p_page_size
  ), rows as(select coalesce(jsonb_agg(to_jsonb(paged)-'has_requested_kiosk_status'||jsonb_build_object('stored_status',status,'status',derived_status,'total_kiosks',actual_total_kiosks)),'[]'::jsonb) data from paged)
  select jsonb_build_object('rows',r.data,'totalRows',c.total_rows,'statusCounts',g.data,'warningDays',warning_days,'reportDate',today_date)
  into result from rows r cross join counted c cross join groups g;
  return coalesce(result,'{}'::jsonb);
end;
$$;
revoke all on function public.get_customer_status_data(text,text,text,bigint,text,text,integer,integer) from public,anon;
grant execute on function public.get_customer_status_data(text,text,text,bigint,text,text,integer,integer) to authenticated;

create or replace function private.sync_homepage_primary_group_url()
returns trigger language plpgsql set search_path=pg_catalog,public as $$
declare links jsonb;
begin
  select coalesce(jsonb_agg(case when item->>'key'='primary' then item||jsonb_build_object('url',new.hero_group_cta_url) else item end),'[]'::jsonb)
  into links from jsonb_array_elements(new.community_links) item;
  new.community_links:=links;
  return new;
end;
$$;
revoke all on function private.sync_homepage_primary_group_url() from public;
drop trigger if exists homepage_primary_group_single_source on public.homepage_content;
create trigger homepage_primary_group_single_source before insert or update of hero_group_cta_url,community_links on public.homepage_content
for each row execute function private.sync_homepage_primary_group_url();

commit;
