-- Optional one-to-one link from an HR Employee to an internal CRM login.
-- Employee remains the personnel source of truth; user_profiles remains auth/access only.
begin;

insert into public.app_permissions(permission,display_name,sort_order,is_active)
values('employees','Nhân viên',135,true)
on conflict(permission) do update
set display_name=excluded.display_name,sort_order=excluded.sort_order,is_active=true;

alter table public.employees
  add column if not exists user_id uuid;

alter table public.employees
  drop constraint if exists employees_user_id_fkey;

alter table public.employees
  add constraint employees_user_id_fkey
  foreign key (user_id)
  references public.user_profiles(user_id)
  on delete set null;

create unique index if not exists employees_user_id_unique_idx
  on public.employees(user_id)
  where user_id is not null;

comment on column public.employees.user_id is
  'Optional CRM login identity. NULL is normal; unlinking or deleting the Website User retains Employee history.';

drop policy if exists employees_expenses_read on public.employees;
drop policy if exists employees_permission_read on public.employees;
create policy employees_permission_read on public.employees
for select to authenticated
using((select public.has_user_permission('employees')));

create or replace function public.get_employees_data(
  p_search text default null,
  p_status text default null,
  p_include_archived boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
begin
  if not public.has_user_permission('employees') then
    raise exception 'Không có quyền quản lý nhân viên.' using errcode='42501';
  end if;

  return jsonb_build_object(
    'rows',
    coalesce((
      select jsonb_agg(
        to_jsonb(e) || jsonb_build_object(
          'website_user', case when up.user_id is null then null else jsonb_build_object(
            'user_id', up.user_id,
            'username', up.username,
            'display_name', up.display_name,
            'status', up.status,
            'web_access_enabled', up.web_access_enabled,
            'is_system_admin', up.is_system_admin
          ) end
        )
        order by e.archived_at nulls first,e.full_name,e.id
      )
      from public.employees e
      left join public.user_profiles up on up.user_id=e.user_id
      where (p_include_archived or e.archived_at is null)
        and (nullif(p_status,'') is null or e.employment_status=p_status)
        and (
          nullif(btrim(p_search),'') is null
          or concat_ws(' ',e.full_name,e.phone,e.job_title,up.username,up.display_name)
            ilike '%'||btrim(p_search)||'%'
        )
    ),'[]'::jsonb)
  );
end $$;

create or replace function public.save_employee(
  p_id bigint,
  p_full_name text,
  p_phone text default null,
  p_job_title text default null,
  p_start_date date default null,
  p_employment_status text default 'active',
  p_notes text default null
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare previous public.employees%rowtype; saved public.employees%rowtype; message text;
begin
  if not public.has_user_permission('employees') then raise exception 'Không có quyền quản lý nhân viên.' using errcode='42501'; end if;
  if p_full_name is null or length(btrim(p_full_name)) not between 1 and 160 then raise exception 'Họ tên phải có từ 1 đến 160 ký tự.'; end if;
  if p_employment_status is null or p_employment_status not in ('active','left') then raise exception 'Trạng thái làm việc không hợp lệ.'; end if;
  if p_id is null then
    insert into public.employees(full_name,phone,job_title,start_date,employment_status,notes)
    values(btrim(p_full_name),nullif(btrim(p_phone),''),nullif(btrim(p_job_title),''),p_start_date,p_employment_status,nullif(btrim(p_notes),'')) returning * into saved;
    message:='Đã tạo nhân viên '||saved.full_name;
  else
    select * into previous from public.employees where id=p_id for update;
    if previous.id is null then raise exception 'Nhân viên không tồn tại.'; end if;
    if previous.archived_at is not null then raise exception 'Khôi phục nhân viên trước khi chỉnh sửa.'; end if;
    update public.employees set full_name=btrim(p_full_name),phone=nullif(btrim(p_phone),''),job_title=nullif(btrim(p_job_title),''),
      start_date=p_start_date,employment_status=p_employment_status,notes=nullif(btrim(p_notes),'') where id=p_id returning * into saved;
    message:=case when previous.employment_status<>saved.employment_status then saved.full_name||case when saved.employment_status='left' then ' đã nghỉ việc' else ' đã làm việc trở lại' end else 'Đã cập nhật nhân viên '||saved.full_name end;
  end if;
  perform private.log_employee_change(previous,saved,message);
  return to_jsonb(saved);
end $$;

create or replace function public.set_employee_lifecycle(p_id bigint,p_action text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare previous public.employees%rowtype; saved public.employees%rowtype; message text;
begin
  if not public.has_user_permission('employees') then raise exception 'Không có quyền quản lý nhân viên.' using errcode='42501'; end if;
  select * into previous from public.employees where id=p_id for update;
  if previous.id is null then raise exception 'Nhân viên không tồn tại.'; end if;
  if p_action is null or p_action not in ('archive','restore','left','reactivate') then raise exception 'Thao tác không hợp lệ.'; end if;
  if previous.archived_at is not null and p_action not in ('restore','archive') then raise exception 'Khôi phục nhân viên trước khi đổi trạng thái.'; end if;
  if (p_action='archive' and previous.archived_at is not null) or (p_action='restore' and previous.archived_at is null)
    or (p_action='left' and previous.employment_status='left') or (p_action='reactivate' and previous.employment_status='active') then return to_jsonb(previous); end if;
  update public.employees set archived_at=case when p_action='archive' then now() when p_action='restore' then null else archived_at end,
    employment_status=case when p_action='left' then 'left' when p_action='reactivate' then 'active' else employment_status end
    where id=p_id returning * into saved;
  message:=case p_action when 'archive' then 'Đã lưu trữ nhân viên '||saved.full_name when 'restore' then 'Đã khôi phục nhân viên '||saved.full_name
    when 'left' then saved.full_name||' đã nghỉ việc' else saved.full_name||' đã làm việc trở lại' end;
  perform private.log_employee_change(previous,saved,message);
  return to_jsonb(saved);
end $$;

revoke all on function public.get_employees_data(text,text,boolean) from public,anon;
revoke all on function public.save_employee(bigint,text,text,text,date,text,text) from public,anon;
revoke all on function public.set_employee_lifecycle(bigint,text) from public,anon;
grant execute on function public.get_employees_data(text,text,boolean) to authenticated;
grant execute on function public.save_employee(bigint,text,text,text,date,text,text) to authenticated;
grant execute on function public.set_employee_lifecycle(bigint,text) to authenticated;

commit;
