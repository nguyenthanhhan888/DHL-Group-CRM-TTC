-- QA Round 1: forward-only lifecycle, permission and shared business read models.
-- This migration preserves payment/audit history and never expires a business
-- intent merely because its PayOS checkout UI has expired.
begin;

alter table public.customers add column if not exists archived_at timestamptz;
alter table public.customers add column if not exists archived_reason text;
alter table public.registration_batches
  add column if not exists provisional_customer_id bigint references public.customers(id) on delete restrict;

create or replace function private.mark_registration_provisional_customer()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  -- A customer inserted in the same transaction as its first registration
  -- batch is safe to identify as provisional. Existing customers are never marked.
  if new.customer_id is not null and exists (
    select 1 from public.customers c
    where c.id = new.customer_id
      and c.xmin::text = pg_current_xact_id()::text
      and lower(c.status) = 'pending'
  ) then new.provisional_customer_id := new.customer_id; end if;
  return new;
end;
$$;
revoke all on function private.mark_registration_provisional_customer() from public;
drop trigger if exists registration_batch_mark_provisional_customer on public.registration_batches;
create trigger registration_batch_mark_provisional_customer before insert on public.registration_batches
for each row execute function private.mark_registration_provisional_customer();

-- Unified module assertions used by legacy payment/audit RPCs.
create or replace function private.assert_audit_access()
returns public.user_roles language plpgsql stable security definer set search_path = '' as $$
declare actor public.user_roles%rowtype;
begin
  if not public.has_user_permission('logs') then
    raise exception 'Không có quyền xem audit log.' using errcode = '42501';
  end if;
  select up.user_id, up.username, coalesce(up.display_name, up.username),
    case when up.is_system_admin then 'admin' else 'staff' end, true,
    up.created_at, up.updated_at
  into actor from public.user_profiles up where up.user_id = auth.uid();
  return actor;
end;
$$;

create or replace function private.assert_payment_permission()
returns public.user_roles language plpgsql stable security definer set search_path = '' as $$
declare actor public.user_roles%rowtype;
begin
  if not public.has_user_permission('payments') then
    raise exception 'Không có quyền xử lý thanh toán.' using errcode = '42501';
  end if;
  select up.user_id, up.username, coalesce(up.display_name, up.username),
    case when up.is_system_admin then 'admin' else 'staff' end, true,
    up.created_at, up.updated_at
  into actor from public.user_profiles up where up.user_id = auth.uid();
  return actor;
end;
$$;
revoke all on function private.assert_audit_access(), private.assert_payment_permission() from public;

-- Convert the effective report RPC's legacy role guard to the canonical module
-- permission while retaining the already-audited report calculations verbatim.
do $migration$
declare target regprocedure := 'public.get_reports_data(text,date,date,bigint,bigint,bigint,bigint,text,text,text,text,integer,integer)'::regprocedure;
  definition text; changed text;
begin
  select pg_get_functiondef(target) into definition;
  changed := regexp_replace(definition,
    'if auth\.uid\(\) is null or not exists \([\s\S]*?\) then\s+raise exception ''Không có quyền xem Báo cáo\.''\s+using errcode = ''42501'';\s+end if;',
    'if not public.has_user_permission(''reports'') then raise exception ''Không có quyền xem Báo cáo.'' using errcode = ''42501''; end if;');
  if changed = definition then raise exception 'Reports authorization guard did not match expected production definition.'; end if;
  execute changed;
end
$migration$;

create or replace function public.get_registration_operations_summary()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_user_permission('reports') then
    raise exception 'Không có quyền xem tổng hợp đăng ký.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'pendingPayments', (select count(*) from public.payments where payment_status='pending'),
    'awaitingPaymentRequests', (select count(*) from public.registration_requests where status='awaiting_payment'),
    'pendingKiosks', (select count(*) from public.registered_kiosks where status='pending'),
    'pendingReviewRequests', (select count(*) from public.registration_requests where status='pending')
  );
end;
$$;
revoke all on function public.get_registration_operations_summary() from public, anon;
grant execute on function public.get_registration_operations_summary() to authenticated;

create or replace function public.get_registration_actionable_summary()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_user_permission('registration-requests') and not public.has_user_permission('notifications') then
    raise exception 'Không có quyền xem hồ sơ cần xử lý.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'pendingReviewCount', (select count(*) from public.registration_requests where status='pending'),
    'awaitingPaymentCount', (select count(*) from public.registration_requests where status='awaiting_payment'),
    'reconciliationCount', (select count(*) from public.payos_orders where reconciliation_required),
    'pendingItems', coalesce((select jsonb_agg(to_jsonb(x) order by x.submitted_at desc) from (
      select id,facebook_name,submitted_at,metadata from public.registration_requests where status='pending' order by submitted_at desc limit 10
    ) x),'[]'::jsonb),
    'awaitingPaymentItems', coalesce((select jsonb_agg(to_jsonb(x) order by x.submitted_at desc) from (
      select id,facebook_name,submitted_at from public.registration_requests where status='awaiting_payment' order by submitted_at desc limit 10
    ) x),'[]'::jsonb)
  );
end;
$$;
revoke all on function public.get_registration_actionable_summary() from public, anon;
grant execute on function public.get_registration_actionable_summary() to authenticated;

create or replace function public.get_current_financial_kpis()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare business_now timestamp := now() at time zone 'Asia/Ho_Chi_Minh';
  year_start timestamptz; month_start timestamptz; year_revenue numeric; month_revenue numeric; year_expense numeric;
begin
  if not public.has_user_permission('reports') then raise exception 'Không có quyền xem Báo cáo.' using errcode='42501'; end if;
  year_start := date_trunc('year',business_now) at time zone 'Asia/Ho_Chi_Minh';
  month_start := date_trunc('month',business_now) at time zone 'Asia/Ho_Chi_Minh';
  select coalesce(sum(total_amount),0) into year_revenue from public.payment_business_dates
    where payment_status='completed' and confirmed_at>=year_start and confirmed_at<=now();
  select coalesce(sum(total_amount),0) into month_revenue from public.payment_business_dates
    where payment_status='completed' and confirmed_at>=month_start and confirmed_at<=now();
  select coalesce(sum(amount),0) into year_expense from public.expenses
    where archived_at is null and expense_date >= (business_now::date - (extract(doy from business_now)::integer - 1)) and expense_date<=business_now::date;
  return jsonb_build_object('year',extract(year from business_now)::integer,'month',extract(month from business_now)::integer,
    'yearRevenue',year_revenue,'monthRevenue',month_revenue,'yearExpense',year_expense,'yearProfit',year_revenue-year_expense,
    'timeZone','Asia/Ho_Chi_Minh','revenueSemantics','completed + confirmed_at');
end;
$$;
revoke all on function public.get_current_financial_kpis() from public, anon;
grant execute on function public.get_current_financial_kpis() to authenticated;

-- One business event read model for Dashboard and Logs. Payment intent is
-- classified from durable linkage; unknown intent is reconciliation, never guessed.
create or replace function public.get_business_events(
  p_context text default 'logs', p_search_term text default null, p_actor_filter text default null,
  p_activity_filter text default null, p_source_filter text default null,
  p_from_time timestamptz default null, p_to_time timestamptz default null,
  p_page integer default 1, p_page_size integer default 20
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb; normalized_page integer:=greatest(coalesce(p_page,1),1); normalized_size integer:=case when p_page_size in(5,10,20,50) then p_page_size else 20 end;
begin
  if lower(coalesce(p_context,''))='dashboard' then
    if not public.has_user_permission('dashboard') then raise exception 'Không có quyền xem Dashboard.' using errcode='42501'; end if;
  elsif not public.has_user_permission('logs') then raise exception 'Không có quyền xem Business Logs.' using errcode='42501'; end if;
  with payment_events as materialized (
    select 'payment:'||p.id as event_key,
      case when exists(select 1 from public.registration_requests r where r.payment_id=p.id and lower(coalesce(r.metadata->>'request_type',r.metadata->>'source',r.metadata->>'registration_type','')) similar to '%(legacy|additional)%') then 'legacy'
        when p.registration_batch_id is not null or p.registration_request_id is not null then 'registration'
        when lower(coalesce(p.transaction_type,''))='renewal' or lower(coalesce(p.payment_intent_key,'')) like '%renewal:%' then 'renewal'
        else 'reconciliation' end event_type,
      case when exists(select 1 from public.registration_requests r where r.payment_id=p.id and lower(coalesce(r.metadata->>'request_type',r.metadata->>'source',r.metadata->>'registration_type','')) similar to '%(legacy|additional)%') then 'Bổ sung / Legacy'
        when p.registration_batch_id is not null then 'Đăng ký Kiosk' when lower(coalesce(p.transaction_type,''))='renewal' then 'Gia hạn' else 'Thanh toán' end activity_label,
      coalesce(k.facebook_name,c.facebook_name,'Kiosk') subject_name,p.total_amount amount,p.confirmed_at occurred_at,
      case when p.confirmed_by is null or lower(p.payment_method)='payos' then 'PayOS' else 'Admin' end source,
      coalesce(p.confirmed_by,'PayOS') actor_name,
      case when exists(select 1 from public.registration_requests r where r.payment_id=p.id and lower(coalesce(r.metadata->>'request_type',r.metadata->>'source',r.metadata->>'registration_type','')) similar to '%(legacy|additional)%') then 'Bổ sung Kiosk '||coalesce(k.facebook_name,c.facebook_name,'')||' thành công'
        when p.registration_batch_id is not null or p.registration_request_id is not null then 'Đăng ký Kiosk '||coalesce(k.facebook_name,c.facebook_name,'')||' thành công'
        when lower(coalesce(p.transaction_type,''))='renewal' then 'Kiosk '||coalesce(k.facebook_name,'')||' đã gia hạn '||coalesce(p.months,0)||' tháng'
        else 'Thanh toán #'||p.id||' cần đối soát intent' end title,
      trim(to_char(p.total_amount,'FM999G999G999G990'))||' VNĐ · '||coalesce(nullif(p.payment_method,''),'PayOS') secondary,'Hoàn tất' result
    from public.payment_business_dates p left join public.kiosks k on k.id=p.kiosk_id left join public.customers c on c.id=p.customer_id
    where p.payment_status='completed' and p.confirmed_at is not null
  ), legacy_events as materialized (
    select 'request:'||r.id event_key,'legacy' event_type,'Bổ sung / Legacy' activity_label,coalesce(k.facebook_name,r.facebook_name,'Kiosk') subject_name,
      coalesce(r.total_amount,0) amount,r.reviewed_at occurred_at,'Admin' source,coalesce(up.display_name,up.username,'Admin') actor_name,
      'Bổ sung Kiosk '||coalesce(k.facebook_name,r.facebook_name,'')||' thành công' title,
      case when coalesce(r.total_amount,0)>0 then trim(to_char(r.total_amount,'FM999G999G999G990'))||' VNĐ' else null end secondary,'Hoàn tất' result
    from public.registration_requests r left join public.kiosks k on k.id=r.kiosk_id left join public.user_profiles up on up.user_id=r.reviewed_by
    where r.status='approved' and r.reviewed_at is not null and r.payment_id is null
      and lower(coalesce(r.metadata->>'request_type',r.metadata->>'source',r.metadata->>'registration_type','')) similar to '%(legacy|additional)%'
  ), reconciliation_events as materialized (
    select 'reconciliation:'||o.id event_key,'reconciliation' event_type,'Đối soát' activity_label,coalesce(k.facebook_name,c.facebook_name,'Thanh toán') subject_name,
      o.amount,o.updated_at occurred_at,'PayOS' source,'PayOS' actor_name,'Giao dịch PayOS cần Admin đối soát' title,
      coalesce(o.reconciliation_reason,'Không xác định được intent') secondary,'Cần xử lý' result
    from public.payos_orders o left join public.payments p on p.id=o.payment_id left join public.kiosks k on k.id=p.kiosk_id left join public.customers c on c.id=p.customer_id
    where o.reconciliation_required
  ), audit_events as materialized (
    select 'audit:'||al.id event_key,
      case
        when lower(coalesce(al.module,''))='payment' and al.after->>'correction_type'='historical_payment' then 'payment'
        when lower(coalesce(al.module,'')) in ('expense','expenses') then 'expense'
        when lower(coalesce(al.module,'')) in ('homepage','homepage content','website','featured business') then 'website'
        when lower(coalesce(al.action,'')) similar to '%(cancel|reject|delete|archive)%' then 'cancel'
        when lower(coalesce(al.entity,'')) like '%kiosk%' and lower(coalesce(al.action,'')) similar to '%(status|suspend|reactivat|deactivat)%' then 'status'
        else 'update'
      end event_type,
      case
        when lower(coalesce(al.module,''))='payment' and al.after->>'correction_type'='historical_payment' then 'Điều chỉnh thanh toán'
        when lower(coalesce(al.module,'')) in ('expense','expenses') then 'Chi phí'
        when lower(coalesce(al.module,'')) in ('homepage','homepage content','website','featured business') then 'Nội dung Website'
        when lower(coalesce(al.action,'')) similar to '%(cancel|reject|delete|archive)%' then 'Hủy'
        when lower(coalesce(al.entity,'')) like '%kiosk%' and lower(coalesce(al.action,'')) similar to '%(status|suspend|reactivat|deactivat)%' then 'Trạng thái Kiosk'
        else 'Cập nhật'
      end activity_label,
      coalesce(nullif(al.after->>'facebook_name',''),nullif(al.after->>'name',''),nullif(al.before->>'facebook_name',''),nullif(al.before->>'name',''),al.entity,'Bản ghi') subject_name,
      case when lower(coalesce(al.module,''))='payment' and al.after->>'correction_type'='historical_payment'
        then nullif(al.after->>'total_amount','')::numeric else null::numeric end amount,
      al.created_at occurred_at,'CRM' source,coalesce(nullif(al.actor_name,''),'Hệ thống') actor_name,
      case
        when lower(coalesce(al.module,''))='payment' and al.after->>'correction_type'='historical_payment'
          then 'Cập nhật thanh toán lịch sử #'||coalesce(al.record_id,al.after->>'payment_id','')
        when lower(coalesce(al.module,'')) in ('expense','expenses') then coalesce(nullif(al.reason,''),'Cập nhật chi phí')
        when lower(coalesce(al.module,'')) in ('homepage','homepage content','website','featured business') then coalesce(nullif(al.reason,''),'Cập nhật nội dung Website')
        when lower(coalesce(al.action,'')) similar to '%(cancel|reject|delete|archive)%' then coalesce(nullif(al.reason,''),'Hủy '||coalesce(al.entity,'bản ghi'))
        else coalesce(nullif(al.reason,''),'Cập nhật '||coalesce(al.entity,'bản ghi'))
      end title,
      concat_ws(' · ',nullif(al.module,''),nullif(al.action,'')) secondary,'Hoàn tất' result
    from public.audit_logs al
    where (lower(coalesce(al.module,''))='payment' and al.after->>'correction_type'='historical_payment')
       or lower(coalesce(al.module,'')) in ('expense','expenses','homepage','homepage content','website','featured business','customer','customers','kiosk','kiosks')
       or (lower(coalesce(al.module,'')) in ('registration','registrations') and lower(coalesce(al.action,'')) similar to '%(cancel|reject|delete|archive)%')
  ), all_events as (
    select * from payment_events union all select * from legacy_events union all
    select * from reconciliation_events union all select * from audit_events
  ), filtered as materialized (
    select * from all_events e where (p_from_time is null or e.occurred_at>=p_from_time) and (p_to_time is null or e.occurred_at<p_to_time)
      and (nullif(btrim(p_activity_filter),'') is null or e.event_type=lower(p_activity_filter))
      and (nullif(btrim(p_source_filter),'') is null or lower(e.source)=lower(p_source_filter))
      and (nullif(btrim(p_actor_filter),'') is null or e.actor_name ilike '%'||btrim(p_actor_filter)||'%')
      and (nullif(btrim(p_search_term),'') is null or concat_ws(' ',e.title,e.secondary,e.subject_name,e.activity_label) ilike '%'||btrim(p_search_term)||'%')
  ), paged as (select * from filtered order by occurred_at desc,event_key desc limit normalized_size offset (normalized_page-1)*normalized_size)
  select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(p) order by occurred_at desc,event_key desc) from paged p),'[]'::jsonb),
    'total',(select count(*) from filtered),'page',normalized_page,'pageSize',normalized_size) into result;
  return result;
end;
$$;
revoke all on function public.get_business_events(text,text,text,text,text,timestamptz,timestamptz,integer,integer) from public, anon;
grant execute on function public.get_business_events(text,text,text,text,text,timestamptz,timestamptz,integer,integer) to authenticated;

-- Public homepage assets: anonymous read, homepage-content editor write.
do $storage$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
    values('homepage-assets','homepage-assets',true,5242880,array['image/jpeg','image/png','image/webp','image/gif'])
    on conflict(id) do update set public=true,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
    execute 'drop policy if exists homepage_assets_public_read on storage.objects';
    execute 'create policy homepage_assets_public_read on storage.objects for select to public using (bucket_id=''homepage-assets'')';
    execute 'drop policy if exists homepage_assets_editor_insert on storage.objects';
    execute 'create policy homepage_assets_editor_insert on storage.objects for insert to authenticated with check (bucket_id=''homepage-assets'' and public.has_user_permission(''homepage-content''))';
    execute 'drop policy if exists homepage_assets_editor_update on storage.objects';
    execute 'create policy homepage_assets_editor_update on storage.objects for update to authenticated using (bucket_id=''homepage-assets'' and public.has_user_permission(''homepage-content'')) with check (bucket_id=''homepage-assets'' and public.has_user_permission(''homepage-content''))';
    execute 'drop policy if exists homepage_assets_editor_delete on storage.objects';
    execute 'create policy homepage_assets_editor_delete on storage.objects for delete to authenticated using (bucket_id=''homepage-assets'' and public.has_user_permission(''homepage-content''))';
  end if;
end
$storage$;

commit;
