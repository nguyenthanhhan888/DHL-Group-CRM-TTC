-- Job V2: assign work to independent Employee records, not CRM login accounts.
-- Existing assignee_user_id values and V1 RPC signatures remain intact for history
-- and rolling-deployment compatibility. No automatic Employee backfill is attempted.
begin;

set local lock_timeout = '5s';

alter table public.crm_work_items
  add column if not exists assignee_employee_id bigint;

alter table public.crm_work_items
  drop constraint if exists crm_work_items_assignee_employee_id_fkey;

alter table public.crm_work_items
  add constraint crm_work_items_assignee_employee_id_fkey
  foreign key (assignee_employee_id)
  references public.employees(id)
  on delete restrict;

create index if not exists crm_work_items_assignee_employee_id_idx
  on public.crm_work_items(assignee_employee_id)
  where assignee_employee_id is not null;

comment on column public.crm_work_items.assignee_employee_id is
  'Independent HR Employee assigned to the Job. assignee_user_id is retained only for legacy Job history.';

insert into public.app_permissions(permission,display_name,sort_order,is_active)
values('work-items','Job',145,true)
on conflict(permission) do update
set display_name=excluded.display_name,sort_order=excluded.sort_order,is_active=true;

-- Employee-based overload. The UUID overload from V1 stays callable by older clients.
create or replace function public.get_crm_work_items(
  p_search text,
  p_status text,
  p_work_type text,
  p_assignee_employee_id bigint,
  p_from_date date,
  p_to_date date,
  p_include_closed boolean
)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare normalized_search text:=nullif(btrim(coalesce(p_search,'')),'');
begin
  if not public.has_user_permission('work-items') then
    raise exception 'Không có quyền quản lý Job.' using errcode='42501';
  end if;
  if p_status is not null and p_status not in ('open','pending','in_progress','completed','cancelled','all') then
    raise exception 'Trạng thái Job không hợp lệ.';
  end if;
  if p_work_type is not null and p_work_type not in ('pr_post','banner','customer_followup','admin_task','note','other') then
    raise exception 'Loại Job không hợp lệ.';
  end if;
  if p_from_date is not null and p_to_date is not null and p_from_date>p_to_date then
    raise exception 'Khoảng ngày Job không hợp lệ.';
  end if;

  return jsonb_build_object(
    'rows',coalesce((
      select jsonb_agg(row_data order by
        case row_data->>'status' when 'in_progress' then 0 when 'pending' then 1 else 2 end,
        nullif(row_data->>'relevant_date','')::date nulls last,
        (row_data->>'updated_at')::timestamptz desc,
        (row_data->>'id')::bigint desc)
      from (
        select to_jsonb(w)||jsonb_build_object(
          'customer_name',c.facebook_name,
          'kiosk_name',k.facebook_name,
          'assignee_name',coalesce(employee.full_name,legacy_assignee.display_name,legacy_assignee.username),
          'assignee_source',case when employee.id is not null then 'employee' when legacy_assignee.user_id is not null then 'legacy_user' else null end,
          'assignee_employee_status',employee.employment_status,
          'assignee_employee_archived_at',employee.archived_at,
          'assignee_username',legacy_assignee.username,
          'creator_name',coalesce(creator.display_name,creator.username,'Tài khoản đã xóa'),
          'relevant_date',coalesce(w.due_date,w.start_date)
        ) row_data
        from public.crm_work_items w
        left join public.customers c on c.id=w.customer_id
        left join public.kiosks k on k.id=w.kiosk_id
        left join public.employees employee on employee.id=w.assignee_employee_id
        left join public.user_profiles legacy_assignee on legacy_assignee.user_id=w.assignee_user_id
        left join public.user_profiles creator on creator.user_id=w.created_by
        where (
            p_status='all'
            or (coalesce(p_status,'open')='open' and w.status in ('pending','in_progress'))
            or (p_status in ('pending','in_progress','completed','cancelled') and w.status=p_status)
            or (p_status is null and p_include_closed)
          )
          and (p_work_type is null or w.work_type=p_work_type)
          and (p_assignee_employee_id is null or w.assignee_employee_id=p_assignee_employee_id)
          and (p_from_date is null or coalesce(w.due_date,w.start_date)>=p_from_date)
          and (p_to_date is null or coalesce(w.due_date,w.start_date)<=p_to_date)
          and (normalized_search is null or concat_ws(' ',w.title,w.note,c.facebook_name,k.facebook_name,
            employee.full_name,legacy_assignee.display_name,legacy_assignee.username) ilike '%'||normalized_search||'%')
      ) rows_source
    ),'[]'::jsonb),
    'customers',coalesce((
      select jsonb_agg(jsonb_build_object('id',c.id,'name',c.facebook_name) order by c.facebook_name,c.id)
      from public.customers c
    ),'[]'::jsonb),
    'kiosks',coalesce((
      select jsonb_agg(jsonb_build_object('id',k.id,'customer_id',k.customer_id,'name',k.facebook_name) order by k.facebook_name,k.id)
      from public.kiosks k
    ),'[]'::jsonb),
    'employees',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',employee.id,
        'name',employee.full_name,
        'employment_status',employee.employment_status,
        'archived_at',employee.archived_at,
        'is_eligible',employee.employment_status='active' and employee.archived_at is null
      ) order by
        case when employee.employment_status='active' and employee.archived_at is null then 0 else 1 end,
        employee.full_name,employee.id)
      from public.employees employee
      where (employee.employment_status='active' and employee.archived_at is null)
        or exists(select 1 from public.crm_work_items assigned where assigned.assignee_employee_id=employee.id)
    ),'[]'::jsonb),
    -- Retained so older presentation code can continue rendering during a rolling release.
    'assignees',coalesce((
      select jsonb_agg(jsonb_build_object('user_id',up.user_id,'name',coalesce(up.display_name,up.username),'username',up.username)
        order by coalesce(up.display_name,up.username),up.user_id)
      from public.user_profiles up where up.status='active' and up.web_access_enabled
    ),'[]'::jsonb)
  );
end $$;

-- Employee-based overload. New Jobs are always pending. On edit, a legacy User
-- assignment is preserved until an Employee is explicitly selected.
create or replace function public.save_crm_work_item(
  p_id bigint,
  p_title text,
  p_work_type text,
  p_customer_id bigint,
  p_kiosk_id bigint,
  p_assignee_employee_id bigint,
  p_start_date date,
  p_due_date date,
  p_status text,
  p_note text default null
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor public.user_profiles%rowtype;
  previous public.crm_work_items%rowtype;
  saved public.crm_work_items%rowtype;
  normalized_title text:=btrim(coalesce(p_title,''));
  normalized_type text:=lower(btrim(coalesce(p_work_type,'')));
  normalized_status text:=lower(btrim(coalesce(p_status,'pending')));
  normalized_note text:=nullif(btrim(coalesce(p_note,'')),'');
begin
  if not public.has_user_permission('work-items') then
    raise exception 'Không có quyền quản lý Job.' using errcode='42501';
  end if;
  select * into actor from public.user_profiles where user_id=auth.uid();
  if actor.user_id is null then raise exception 'Không tìm thấy tài khoản thực hiện.' using errcode='42501'; end if;
  if p_id is not null then
    select * into previous from public.crm_work_items where id=p_id for update;
    if previous.id is null then raise exception 'Job không tồn tại.'; end if;
  else
    normalized_status:='pending';
  end if;
  if length(normalized_title) not between 1 and 200 then raise exception 'Tiêu đề phải có từ 1 đến 200 ký tự.'; end if;
  if normalized_type not in ('pr_post','banner','customer_followup','admin_task','note','other') then raise exception 'Loại Job không hợp lệ.'; end if;
  if normalized_status not in ('pending','in_progress','completed','cancelled') then raise exception 'Trạng thái Job không hợp lệ.'; end if;
  if normalized_note is not null and length(normalized_note)>10000 then raise exception 'Nội dung tối đa 10.000 ký tự.'; end if;
  if (previous.id is null or normalized_type<>previous.work_type)
    and normalized_type='banner' and (p_start_date is null or p_due_date is null)
    then raise exception 'Banner cần ngày bắt đầu và ngày kết thúc.'; end if;
  if (previous.id is null or normalized_type<>previous.work_type)
    and normalized_type in ('pr_post','customer_followup','admin_task') and p_due_date is null
    then raise exception 'Loại Job này cần ngày thực hiện.'; end if;
  if p_start_date is not null and p_due_date is not null and p_start_date>p_due_date then raise exception 'Ngày kết thúc không được trước ngày bắt đầu.'; end if;
  if p_customer_id is not null and not exists(select 1 from public.customers where id=p_customer_id) then raise exception 'Khách hàng không tồn tại.'; end if;
  if p_kiosk_id is not null and p_customer_id is null then raise exception 'Cần chọn Khách hàng trước khi chọn Kiosk.'; end if;
  if p_kiosk_id is not null and not exists(select 1 from public.kiosks where id=p_kiosk_id and customer_id=p_customer_id) then raise exception 'Kiosk không thuộc Khách hàng đã chọn.'; end if;
  if p_assignee_employee_id is not null and not exists(
    select 1 from public.employees employee
    where employee.id=p_assignee_employee_id
      and ((employee.employment_status='active' and employee.archived_at is null)
        or employee.id=previous.assignee_employee_id)
  ) then raise exception 'Nhân viên phụ trách không còn hợp lệ.'; end if;

  -- Normalize scheduling fields so hidden UI values cannot leak into unrelated types.
  if previous.id is null or normalized_type<>previous.work_type then
    if normalized_type='note' then p_start_date:=null;p_due_date:=null;
    elsif normalized_type<>'banner' then p_start_date:=null;
    end if;
  end if;

  if p_id is null then
    insert into public.crm_work_items(title,work_type,customer_id,kiosk_id,assignee_employee_id,assignee_user_id,
      start_date,due_date,status,note,created_by,completed_at)
    values(normalized_title,normalized_type,p_customer_id,p_kiosk_id,p_assignee_employee_id,null,
      p_start_date,p_due_date,'pending',normalized_note,auth.uid(),null)
    returning * into saved;
  else
    if previous.status in ('completed','cancelled') and normalized_status<>previous.status then
      raise exception 'Job đã kết thúc không thể mở lại trong phiên bản này.';
    end if;
    update public.crm_work_items set
      title=normalized_title,work_type=normalized_type,customer_id=p_customer_id,kiosk_id=p_kiosk_id,
      assignee_employee_id=p_assignee_employee_id,
      assignee_user_id=case when p_assignee_employee_id is not null then null else previous.assignee_user_id end,
      start_date=p_start_date,due_date=p_due_date,status=normalized_status,note=normalized_note,
      completed_at=case when normalized_status='completed' then coalesce(previous.completed_at,now()) else null end
    where id=p_id returning * into saved;
  end if;

  insert into public.audit_logs(actor_id,actor_name,actor_role,actor_type,module,entity,record_id,action,before,after,reason)
  values(auth.uid(),coalesce(actor.display_name,actor.username,'Quản trị viên'),case when actor.is_system_admin then 'system_admin' else 'staff' end,'staff',
    'WorkItems','crm_work_items',saved.id::text,case when previous.id is null then 'create_work_item' else 'update_work_item' end,
    case when previous.id is null then null else to_jsonb(previous) end,to_jsonb(saved),coalesce(normalized_note,normalized_title));
  return to_jsonb(saved);
end $$;

revoke all on function public.get_crm_work_items(text,text,text,bigint,date,date,boolean) from public,anon;
revoke all on function public.save_crm_work_item(bigint,text,text,bigint,bigint,bigint,date,date,text,text) from public,anon;
grant execute on function public.get_crm_work_items(text,text,text,bigint,date,date,boolean) to authenticated;
grant execute on function public.save_crm_work_item(bigint,text,text,bigint,bigint,bigint,date,date,text,text) to authenticated;

notify pgrst, 'reload schema';

commit;
