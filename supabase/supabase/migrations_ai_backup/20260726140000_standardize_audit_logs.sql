alter table public.audit_logs
  add column if not exists actor_type text,
  add column if not exists entity text,
  add column if not exists record_id text,
  add column if not exists legacy_log_id bigint;

do $block$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'audit_logs_actor_type_check'
      and conrelid = 'public.audit_logs'::regclass
  ) then
    alter table public.audit_logs
      add constraint audit_logs_actor_type_check
      check (actor_type is null or actor_type in ('staff', 'public', 'system', 'database_trigger'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'audit_logs_legacy_log_id_key'
      and conrelid = 'public.audit_logs'::regclass
  ) then
    alter table public.audit_logs
      add constraint audit_logs_legacy_log_id_key unique (legacy_log_id);
  end if;
end;
$block$;

create index if not exists audit_logs_created_at_idx
  on public.audit_logs(created_at desc);
create index if not exists audit_logs_module_action_created_idx
  on public.audit_logs(module, action, created_at desc);
create index if not exists audit_logs_actor_id_created_idx
  on public.audit_logs(actor_id, created_at desc);
create index if not exists audit_logs_entity_record_idx
  on public.audit_logs(entity, record_id);

create or replace function private.normalize_audit_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  resolved_actor public.user_roles%rowtype;
  request_actor_id uuid := auth.uid();
begin
  if request_actor_id is not null then
    new.actor_id := request_actor_id;
  end if;

  if new.actor_id is not null then
    select *
    into resolved_actor
    from public.user_roles ur
    where ur.user_id = new.actor_id;

    new.actor_type := 'staff';
    new.actor_name := coalesce(
      resolved_actor.display_name,
      resolved_actor.username,
      nullif(trim(new.actor_name), ''),
      'Nhân viên'
    );
    new.actor_role := coalesce(
      resolved_actor.role,
      nullif(trim(new.actor_role), ''),
      'staff'
    );
  elsif lower(coalesce(new.actor_role, '')) in ('anon', 'public')
    or new.actor_type = 'public' then
    new.actor_type := 'public';
    new.actor_name := 'Public User';
    new.actor_role := 'public';
  elsif new.actor_type = 'database_trigger' then
    new.actor_name := 'Database Trigger';
    new.actor_role := 'system';
  else
    new.actor_type := 'system';
    new.actor_name := 'System';
    new.actor_role := 'system';
  end if;

  new.module := coalesce(nullif(trim(new.module), ''), 'System');
  new.entity := coalesce(nullif(trim(new.entity), ''), new.module);
  new.record_id := coalesce(
    nullif(trim(new.record_id), ''),
    new.after->>'id',
    new.before->>'id',
    new.after->'payment'->>'id',
    new.before->'payment'->>'id',
    new.after->>'customer_id',
    new.before->>'customer_id'
  );
  new.action := coalesce(nullif(trim(new.action), ''), 'unknown');
  new.reason := coalesce(nullif(trim(new.reason), ''), 'Không cung cấp lý do');
  new.created_at := coalesce(new.created_at, pg_catalog.now());
  return new;
end;
$function$;

drop trigger if exists normalize_audit_log_trigger on public.audit_logs;
create trigger normalize_audit_log_trigger
before insert on public.audit_logs
for each row execute function private.normalize_audit_log();

-- Preserve and copy legacy rows. The original table remains intact.
insert into public.audit_logs(
  actor_id,
  actor_name,
  actor_type,
  actor_role,
  module,
  entity,
  record_id,
  action,
  before,
  after,
  reason,
  created_at,
  legacy_log_id
)
select
  ur.user_id,
  coalesce(ur.display_name, ur.username, 'System'),
  case when ur.user_id is not null then 'staff' else 'system' end,
  coalesce(ur.role, 'system'),
  coalesce(nullif(trim(l.table_name), ''), 'Legacy'),
  coalesce(nullif(trim(l.table_name), ''), 'Legacy'),
  l.record_id::text,
  coalesce(nullif(trim(l.action), ''), 'unknown'),
  coalesce(l.old_data, l.old_value),
  coalesce(l.new_data, l.new_value),
  'Imported from legacy logs',
  l.created_at,
  l.id
from public.logs l
left join public.user_roles ur
  on ur.user_id::text = l.created_by::text
on conflict (legacy_log_id) do nothing;

create or replace function private.mirror_legacy_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  resolved_actor public.user_roles%rowtype;
begin
  select *
  into resolved_actor
  from public.user_roles ur
  where ur.user_id::text = new.created_by::text;

  insert into public.audit_logs(
    actor_id,
    actor_name,
    actor_type,
    actor_role,
    module,
    entity,
    record_id,
    action,
    before,
    after,
    reason,
    created_at,
    legacy_log_id
  )
  values(
    resolved_actor.user_id,
    coalesce(resolved_actor.display_name, resolved_actor.username, 'System'),
    case when resolved_actor.user_id is not null then 'staff' else 'system' end,
    coalesce(resolved_actor.role, 'system'),
    coalesce(nullif(trim(new.table_name), ''), 'Legacy'),
    coalesce(nullif(trim(new.table_name), ''), 'Legacy'),
    new.record_id::text,
    coalesce(nullif(trim(new.action), ''), 'unknown'),
    coalesce(new.old_data, new.old_value),
    coalesce(new.new_data, new.new_value),
    'Mirrored from legacy logs',
    new.created_at,
    new.id
  )
  on conflict (legacy_log_id) do nothing;

  return new;
end;
$function$;

drop trigger if exists mirror_legacy_log_trigger on public.logs;
create trigger mirror_legacy_log_trigger
after insert on public.logs
for each row execute function private.mirror_legacy_log();

create or replace function private.prevent_audit_log_change()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  raise exception 'Audit logs are immutable.'
    using errcode = '23514';
end;
$function$;

drop trigger if exists prevent_audit_log_change_trigger on public.audit_logs;
create trigger prevent_audit_log_change_trigger
before update or delete on public.audit_logs
for each row execute function private.prevent_audit_log_change();

drop trigger if exists prevent_legacy_log_change_trigger on public.logs;
create trigger prevent_legacy_log_change_trigger
before update or delete on public.logs
for each row execute function private.prevent_audit_log_change();

alter table public.audit_logs enable row level security;
alter table public.logs enable row level security;
revoke all on table public.audit_logs from public, anon, authenticated;
revoke all on table public.logs from public, anon, authenticated;
revoke all on sequence public.audit_logs_id_seq from public, anon, authenticated;

create or replace function private.assert_audit_access()
returns public.user_roles
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  actor public.user_roles%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Bạn phải đăng nhập để xem audit log.'
      using errcode = '42501';
  end if;

  select *
  into actor
  from public.user_roles ur
  where ur.user_id = auth.uid()
    and ur.is_active = true
    and (
      lower(ur.role) = 'admin'
      or exists (
        select 1
        from public.role_permissions rp
        where lower(rp.role) = lower(ur.role)
          and 'logs' = any(rp.permissions)
      )
    );

  if not found then
    raise exception 'Không có quyền xem audit log.'
      using errcode = '42501';
  end if;
  return actor;
end;
$function$;

create or replace function public.write_audit_log(
  module_input text,
  action_input text,
  entity_input text default null,
  record_id_input text default null,
  before_input jsonb default null,
  after_input jsonb default null,
  reason_input text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor public.user_roles%rowtype;
  audit_record public.audit_logs%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Bạn phải đăng nhập để ghi audit log.'
      using errcode = '42501';
  end if;

  select *
  into actor
  from public.user_roles ur
  where ur.user_id = auth.uid()
    and ur.is_active = true;
  if not found then
    raise exception 'Tài khoản không hoạt động.'
      using errcode = '42501';
  end if;

  insert into public.audit_logs(
    actor_id,
    actor_name,
    actor_type,
    actor_role,
    module,
    entity,
    record_id,
    action,
    before,
    after,
    reason
  )
  values(
    actor.user_id,
    coalesce(actor.display_name, actor.username),
    'staff',
    actor.role,
    module_input,
    entity_input,
    record_id_input,
    action_input,
    before_input,
    after_input,
    reason_input
  )
  returning * into audit_record;

  return to_jsonb(audit_record);
end;
$function$;

create or replace function public.get_audit_logs(
  actor_filter text default null,
  module_filter text default null,
  action_filter text default null,
  from_time timestamptz default null,
  to_time timestamptz default null,
  search_term text default null,
  page_number integer default 1,
  page_size integer default 25
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  normalized_page integer := greatest(coalesce(page_number, 1), 1);
  normalized_size integer := case when page_size in (10, 25, 50) then page_size else 25 end;
  result jsonb;
begin
  perform private.assert_audit_access();

  with resolved as (
    select
      al.id,
      al.actor_id,
      case
        when al.actor_id is not null then coalesce(ur.display_name, ur.username, al.actor_name, 'Nhân viên')
        when coalesce(al.actor_type, lower(al.actor_role)) in ('public', 'anon') then 'Public User'
        when al.actor_type = 'database_trigger' then 'Database Trigger'
        else 'System'
      end as actor_name,
      coalesce(
        al.actor_type,
        case
          when al.actor_id is not null then 'staff'
          when lower(al.actor_role) in ('public', 'anon') then 'public'
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
      al.created_at
    from public.audit_logs al
    left join public.user_roles ur on ur.user_id = al.actor_id
  ),
  filtered as (
    select *
    from resolved r
    where (nullif(trim(actor_filter), '') is null
      or r.actor_name ilike '%' || trim(actor_filter) || '%'
      or r.actor_role ilike '%' || trim(actor_filter) || '%'
      or r.actor_type ilike '%' || trim(actor_filter) || '%'
      or r.actor_id::text = trim(actor_filter))
      and (nullif(trim(module_filter), '') is null
        or lower(r.module) = lower(trim(module_filter)))
      and (nullif(trim(action_filter), '') is null
        or lower(r.action) = lower(trim(action_filter)))
      and (from_time is null or r.created_at >= from_time)
      and (to_time is null or r.created_at < to_time)
      and (nullif(trim(search_term), '') is null
        or r.module ilike '%' || trim(search_term) || '%'
        or r.entity ilike '%' || trim(search_term) || '%'
        or r.action ilike '%' || trim(search_term) || '%'
        or r.actor_name ilike '%' || trim(search_term) || '%'
        or coalesce(r.reason, '') ilike '%' || trim(search_term) || '%'
        or coalesce(r.record_id, '') ilike '%' || trim(search_term) || '%')
  ),
  paged as (
    select *
    from filtered
    order by created_at desc, id desc
    limit normalized_size
    offset (normalized_page - 1) * normalized_size
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at desc, p.id desc) from paged p), '[]'::jsonb),
    'total', (select count(*) from filtered),
    'page', normalized_page,
    'pageSize', normalized_size
  )
  into result;

  return result;
end;
$function$;

create or replace function public.get_audit_log(log_id_input bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  result jsonb;
begin
  perform private.assert_audit_access();
  select to_jsonb(r)
  into result
  from (
    select
      al.id,
      al.actor_id,
      case
        when al.actor_id is not null then coalesce(ur.display_name, ur.username, al.actor_name, 'Nhân viên')
        when coalesce(al.actor_type, lower(al.actor_role)) in ('public', 'anon') then 'Public User'
        when al.actor_type = 'database_trigger' then 'Database Trigger'
        else 'System'
      end as actor_name,
      coalesce(
        al.actor_type,
        case
          when al.actor_id is not null then 'staff'
          when lower(al.actor_role) in ('public', 'anon') then 'public'
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
      al.created_at
    from public.audit_logs al
    left join public.user_roles ur on ur.user_id = al.actor_id
    where al.id = log_id_input
  ) r;
  return result;
end;
$function$;

revoke all on function public.write_audit_log(text, text, text, text, jsonb, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.write_audit_log(text, text, text, text, jsonb, jsonb, text)
  to authenticated;

revoke all on function public.get_audit_logs(text, text, text, timestamptz, timestamptz, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.get_audit_logs(text, text, text, timestamptz, timestamptz, text, integer, integer)
  to authenticated;

revoke all on function public.get_audit_log(bigint)
  from public, anon, authenticated;
grant execute on function public.get_audit_log(bigint)
  to authenticated;
