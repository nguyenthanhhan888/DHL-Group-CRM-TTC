-- Round 2: the default journal contains curated business events. Raw audit history
-- remains available through get_audit_logs when the UI technical toggle is on.
begin;

create or replace function public.get_business_events(
  p_context text default 'logs',p_search_term text default null,p_actor_filter text default null,
  p_activity_filter text default null,p_source_filter text default null,
  p_from_time timestamptz default null,p_to_time timestamptz default null,
  p_page integer default 1,p_page_size integer default 20
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; normalized_page integer:=greatest(coalesce(p_page,1),1);
  normalized_size integer:=case when p_page_size in(5,10,20,50) then p_page_size else 20 end;
begin
  if lower(coalesce(p_context,''))='dashboard' then
    if not public.has_user_permission('dashboard') then raise exception 'Không có quyền xem Dashboard.' using errcode='42501'; end if;
  elsif not public.has_user_permission('logs') then raise exception 'Không có quyền xem Business Logs.' using errcode='42501'; end if;
  with payment_events as materialized (
    select 'payment:'||p.id event_key,
      case when exists(select 1 from public.registration_requests r where r.payment_id=p.id and lower(coalesce(r.metadata->>'request_type',r.metadata->>'source',r.metadata->>'registration_type','')) similar to '%(legacy|additional)%') then 'legacy'
        when p.registration_batch_id is not null or p.registration_request_id is not null then 'registration'
        when lower(coalesce(p.transaction_type,''))='renewal' or lower(coalesce(p.payment_intent_key,'')) like '%renewal:%' then 'renewal' else 'reconciliation' end event_type,
      case when exists(select 1 from public.registration_requests r where r.payment_id=p.id and lower(coalesce(r.metadata->>'request_type',r.metadata->>'source',r.metadata->>'registration_type','')) similar to '%(legacy|additional)%') then 'Bổ sung / Legacy'
        when p.registration_batch_id is not null or p.registration_request_id is not null then 'Đăng ký Kiosk'
        when lower(coalesce(p.transaction_type,''))='renewal' then 'Gia hạn' else 'Đối soát' end activity_label,
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
    select 'request:'||r.id event_key,'legacy' event_type,'Bổ sung / Legacy' activity_label,
      coalesce(k.facebook_name,r.facebook_name,'Kiosk') subject_name,coalesce(r.total_amount,0) amount,r.reviewed_at occurred_at,
      'Admin' source,coalesce(up.display_name,up.username,'Admin') actor_name,
      'Bổ sung Kiosk '||coalesce(k.facebook_name,r.facebook_name,'')||' thành công' title,
      case when coalesce(r.total_amount,0)>0 then trim(to_char(r.total_amount,'FM999G999G999G990'))||' VNĐ' else null end secondary,'Hoàn tất' result
    from public.registration_requests r left join public.kiosks k on k.id=r.kiosk_id left join public.user_profiles up on up.user_id=r.reviewed_by
    where r.status='approved' and r.reviewed_at is not null and r.payment_id is null
      and lower(coalesce(r.metadata->>'request_type',r.metadata->>'source',r.metadata->>'registration_type','')) similar to '%(legacy|additional)%'
  ), reconciliation_events as materialized (
    select 'reconciliation:'||o.id event_key,'reconciliation' event_type,'Đối soát' activity_label,
      coalesce(k.facebook_name,c.facebook_name,'Thanh toán') subject_name,o.amount,o.updated_at occurred_at,'PayOS' source,'PayOS' actor_name,
      'Giao dịch PayOS cần Admin đối soát' title,coalesce(o.reconciliation_reason,'Không xác định được intent') secondary,'Cần xử lý' result
    from public.payos_orders o left join public.payments p on p.id=o.payment_id left join public.kiosks k on k.id=p.kiosk_id left join public.customers c on c.id=p.customer_id
    where o.reconciliation_required
  ), audit_events as materialized (
    select 'audit:'||al.id event_key,
      case when lower(coalesce(al.module,''))='payment' and al.after->>'correction_type'='historical_payment' then 'payment'
        when lower(coalesce(al.module,'')) in('expense','expenses') then 'expense'
        when lower(coalesce(al.module,'')) in('homepage','homepage content','website','featured business') then 'website'
        when lower(coalesce(al.action,'')) similar to '%(cancel|reject|delete|archive)%' then 'cancel'
        when lower(coalesce(al.entity,'')) like '%kiosk%' and lower(coalesce(al.action,'')) similar to '%(status|suspend|reactivat|deactivat)%' then 'status' else 'update' end event_type,
      case when lower(coalesce(al.module,''))='payment' then 'Điều chỉnh thanh toán'
        when lower(coalesce(al.module,'')) in('expense','expenses') then 'Chi phí'
        when lower(coalesce(al.module,'')) in('homepage','homepage content','website','featured business') then 'Nội dung Website'
        when lower(coalesce(al.action,'')) similar to '%(cancel|reject|delete|archive)%' then 'Hủy'
        when lower(coalesce(al.entity,'')) like '%kiosk%' and lower(coalesce(al.action,'')) similar to '%(status|suspend|reactivat|deactivat)%' then 'Trạng thái Kiosk' else 'Cập nhật' end activity_label,
      coalesce(nullif(al.after->>'facebook_name',''),nullif(al.after->>'name',''),nullif(al.before->>'facebook_name',''),nullif(al.before->>'name',''),al.entity,'Bản ghi') subject_name,
      case when lower(coalesce(al.module,''))='payment' and al.after->>'correction_type'='historical_payment' then nullif(al.after->>'total_amount','')::numeric else null::numeric end amount,
      al.created_at occurred_at,'CRM' source,coalesce(nullif(al.actor_name,''),'Hệ thống') actor_name,
      case
        when lower(coalesce(al.module,''))='payment' then coalesce(nullif(al.actor_name,''),'Admin')||' đã cập nhật thanh toán lịch sử #'||coalesce(al.record_id,al.after->>'payment_id','')
        when lower(coalesce(al.module,'')) in('expense','expenses') then coalesce(nullif(al.actor_name,''),'Admin')||' · '||coalesce(nullif(al.reason,''),'Cập nhật chi phí')
        when lower(coalesce(al.module,'')) in('homepage','homepage content','website','featured business') then coalesce(nullif(al.actor_name,''),'Admin')||' đã cập nhật nội dung Website'
        when lower(coalesce(al.entity,'')) like '%customer%' then coalesce(nullif(al.actor_name,''),'Admin')||case when lower(al.action)='create' then ' đã thêm khách hàng ' else ' đã cập nhật khách hàng ' end||coalesce(nullif(al.after->>'facebook_name',''),nullif(al.before->>'facebook_name',''),'')
        when lower(coalesce(al.entity,'')) like '%kiosk%' then coalesce(nullif(al.actor_name,''),'Admin')||case when lower(al.action)='create' then ' đã thêm Kiosk ' else ' đã cập nhật Kiosk ' end||coalesce(nullif(al.after->>'facebook_name',''),nullif(al.before->>'facebook_name',''),'')
        else coalesce(nullif(al.actor_name,''),'Admin')||' · '||coalesce(nullif(al.reason,''),'Cập nhật nghiệp vụ') end title,
      case when nullif(al.reason,'') is not null and lower(coalesce(al.module,'')) not in('expense','expenses') then al.reason else null end secondary,'Hoàn tất' result
    from public.audit_logs al
    where private.is_business_audit(al.action,al.entity,al.legacy_log_id,al.reason,al.before,al.after)
      and ((lower(coalesce(al.module,''))='payment' and al.after->>'correction_type'='historical_payment')
        or lower(coalesce(al.module,'')) in('expense','expenses','homepage','homepage content','website','featured business','customer','customers','kiosk','kiosks')
        or (lower(coalesce(al.module,'')) in('registration','registrations') and lower(coalesce(al.action,'')) similar to '%(cancel|reject|delete|archive)%'))
  ), all_events as (
    select * from payment_events union all select * from legacy_events union all select * from reconciliation_events union all select * from audit_events
  ), filtered as materialized (
    select * from all_events e where (p_from_time is null or e.occurred_at>=p_from_time) and (p_to_time is null or e.occurred_at<p_to_time)
      and (nullif(btrim(p_activity_filter),'') is null or e.event_type=lower(p_activity_filter))
      and (nullif(btrim(p_source_filter),'') is null or lower(e.source)=lower(p_source_filter))
      and (nullif(btrim(p_actor_filter),'') is null or e.actor_name ilike '%'||btrim(p_actor_filter)||'%')
      and (nullif(btrim(p_search_term),'') is null or concat_ws(' ',e.title,e.secondary,e.subject_name,e.activity_label) ilike '%'||btrim(p_search_term)||'%')
  ), paged as(select * from filtered order by occurred_at desc,event_key desc limit normalized_size offset(normalized_page-1)*normalized_size)
  select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(p) order by occurred_at desc,event_key desc) from paged p),'[]'::jsonb),
    'total',(select count(*) from filtered),'page',normalized_page,'pageSize',normalized_size) into result;
  return result;
end;
$$;

revoke all on function public.get_business_events(text,text,text,text,text,timestamptz,timestamptz,integer,integer) from public,anon;
grant execute on function public.get_business_events(text,text,text,text,text,timestamptz,timestamptz,integer,integer) to authenticated;

commit;
