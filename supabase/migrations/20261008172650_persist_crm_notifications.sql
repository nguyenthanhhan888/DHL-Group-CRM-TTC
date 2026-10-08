begin;

create table public.crm_notifications (
  id bigint generated always as identity primary key,
  notification_type text not null check (notification_type in ('registration_review', 'payment_reconciliation')),
  entity_type text not null check (entity_type in ('registration_request', 'payos_order')),
  entity_id text not null,
  occurrence_number integer not null check (occurrence_number > 0),
  occurrence_key text not null unique,
  title text not null,
  message text not null,
  target_url text not null,
  created_at timestamptz not null default clock_timestamp(),
  resolved_at timestamptz,
  unique (notification_type, entity_type, entity_id, occurrence_number)
);

create unique index crm_notifications_one_active_occurrence
  on public.crm_notifications (notification_type, entity_type, entity_id)
  where resolved_at is null;

create index crm_notifications_feed_order
  on public.crm_notifications (created_at desc, id desc);

create table public.crm_notification_reads (
  notification_id bigint not null references public.crm_notifications(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz not null default clock_timestamp(),
  primary key (notification_id, user_id)
);

create index crm_notification_reads_user
  on public.crm_notification_reads (user_id, read_at desc);

alter table public.crm_notifications enable row level security;
alter table public.crm_notification_reads enable row level security;

revoke all on table public.crm_notifications, public.crm_notification_reads from public, anon, authenticated;
revoke all on sequence public.crm_notifications_id_seq from public, anon, authenticated;

create function public.sync_crm_notification_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  event_type text;
  related_type text;
  related_id text := source_row ->> 'id';
  is_active boolean;
  next_occurrence integer;
  event_title text;
  event_message text;
  event_target text;
begin
  if tg_table_name = 'registration_requests' then
    event_type := 'registration_review';
    related_type := 'registration_request';
    is_active := tg_op <> 'DELETE'
      and source_row ->> 'status' = 'pending'
      and source_row ->> 'registration_batch_id' is null
      and coalesce(source_row -> 'metadata' ->> 'workflow', '') <> 'public_payos';
    event_title := 'Hồ sơ Kiosk chờ duyệt';
    event_message := coalesce(nullif(source_row ->> 'facebook_name', ''), 'Hồ sơ Kiosk') || ' đang chờ Ban quản trị';
    event_target := '#/registration-requests?status=pending';
  elsif tg_table_name = 'payos_orders' then
    event_type := 'payment_reconciliation';
    related_type := 'payos_order';
    is_active := tg_op <> 'DELETE'
      and coalesce((source_row ->> 'reconciliation_required')::boolean, false);
    event_title := 'Giao dịch cần đối soát';
    event_message := 'Giao dịch #' || related_id || ' cần Admin kiểm tra';
    event_target := '#/payments';
  else
    raise exception 'Unsupported notification source: %', tg_table_name;
  end if;

  if is_active then
    select coalesce(max(n.occurrence_number), 0) + 1
      into next_occurrence
      from public.crm_notifications n
     where n.notification_type = event_type
       and n.entity_type = related_type
       and n.entity_id = related_id;

    insert into public.crm_notifications (
      notification_type, entity_type, entity_id, occurrence_number,
      occurrence_key, title, message, target_url
    ) values (
      event_type, related_type, related_id, next_occurrence,
      event_type || ':' || related_type || ':' || related_id || ':' || next_occurrence,
      event_title, event_message, event_target
    )
    on conflict (notification_type, entity_type, entity_id) where resolved_at is null
    do update set
      title = excluded.title,
      message = excluded.message,
      target_url = excluded.target_url;
  else
    update public.crm_notifications
       set resolved_at = coalesce(resolved_at, clock_timestamp()),
           title = case event_type
             when 'registration_review' then 'Hồ sơ đã rời danh sách chờ duyệt'
             else 'Yêu cầu đối soát đã kết thúc'
           end,
           message = case
             when tg_op = 'DELETE' then 'Bản ghi nguồn không còn khả dụng.'
             when event_type = 'registration_review' then
               coalesce(nullif(source_row ->> 'facebook_name', ''), 'Hồ sơ Kiosk') || ' không còn trong trạng thái chờ duyệt'
             else 'Giao dịch #' || related_id || ' không còn được đánh dấu cần đối soát'
           end,
           target_url = case event_type
             when 'registration_review' then '#/registration-requests'
             else '#/payments'
           end
     where notification_type = event_type
       and entity_type = related_type
       and entity_id = related_id
       and resolved_at is null;
  end if;

  return null;
end;
$$;

revoke all on function public.sync_crm_notification_event() from public, anon, authenticated;

create trigger crm_registration_notification_sync
after insert or update or delete on public.registration_requests
for each row execute function public.sync_crm_notification_event();

create trigger crm_reconciliation_notification_sync
after insert or update or delete on public.payos_orders
for each row execute function public.sync_crm_notification_event();

-- Seed only conditions that are active when this forward migration runs.
insert into public.crm_notifications (
  notification_type, entity_type, entity_id, occurrence_number,
  occurrence_key, title, message, target_url
)
select
  'registration_review', 'registration_request', r.id::text, 1,
  'registration_review:registration_request:' || r.id || ':1',
  'Hồ sơ Kiosk chờ duyệt',
  coalesce(nullif(r.facebook_name, ''), 'Hồ sơ Kiosk') || ' đang chờ Ban quản trị',
  '#/registration-requests?status=pending'
from public.registration_requests r
where r.status = 'pending'
  and r.registration_batch_id is null
  and coalesce(r.metadata ->> 'workflow', '') <> 'public_payos'
on conflict (notification_type, entity_type, entity_id) where resolved_at is null do nothing;

insert into public.crm_notifications (
  notification_type, entity_type, entity_id, occurrence_number,
  occurrence_key, title, message, target_url
)
select
  'payment_reconciliation', 'payos_order', o.id::text, 1,
  'payment_reconciliation:payos_order:' || o.id || ':1',
  'Giao dịch cần đối soát',
  'Giao dịch #' || o.id || ' cần Admin kiểm tra',
  '#/payments'
from public.payos_orders o
where coalesce(o.reconciliation_required, false)
on conflict (notification_type, entity_type, entity_id) where resolved_at is null do nothing;

create function public.get_crm_notifications(
  p_limit integer default 100,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if p_limit < 1 or p_limit > 100 or p_offset < 0 then
    raise exception 'Invalid notification pagination.' using errcode = '22023';
  end if;

  with visible as (
    select n.*, r.read_at
    from public.crm_notifications n
    left join public.crm_notification_reads r
      on r.notification_id = n.id and r.user_id = auth.uid()
    where (
      (n.notification_type = 'registration_review'
        and public.has_user_permission('registration-requests'))
      or
      (n.notification_type = 'payment_reconciliation'
        and public.has_user_permission('payments'))
    )
    and (
      n.resolved_at is null
      or r.read_at is null
      or n.resolved_at >= statement_timestamp() - interval '90 days'
    )
  ), page as (
    select * from visible
    order by (read_at is null) desc, (resolved_at is null) desc, created_at desc, id desc
    limit p_limit offset p_offset
  )
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(to_jsonb(p) order by
        (p.read_at is null) desc, (p.resolved_at is null) desc, p.created_at desc, p.id desc)
      from page p
    ), '[]'::jsonb),
    'unreadCount', (select count(*) from visible where read_at is null)
  ) into result;

  return result;
end;
$$;

create function public.mark_crm_notification_read(p_notification_id bigint)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  marked_at timestamptz := statement_timestamp();
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.crm_notifications n
    where n.id = p_notification_id
      and (
        (n.notification_type = 'registration_review'
          and public.has_user_permission('registration-requests'))
        or
        (n.notification_type = 'payment_reconciliation'
          and public.has_user_permission('payments'))
      )
  ) then
    raise exception 'Notification unavailable.' using errcode = '42501';
  end if;

  insert into public.crm_notification_reads (notification_id, user_id, read_at)
  values (p_notification_id, auth.uid(), marked_at)
  on conflict (notification_id, user_id) do nothing;

  return marked_at;
end;
$$;

create function public.mark_all_crm_notifications_read()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected integer;
  marked_at timestamptz := statement_timestamp();
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  insert into public.crm_notification_reads (notification_id, user_id, read_at)
  select n.id, auth.uid(), statement_timestamp()
  from public.crm_notifications n
  where n.created_at <= marked_at
    and (
      (n.notification_type = 'registration_review'
        and public.has_user_permission('registration-requests'))
      or
      (n.notification_type = 'payment_reconciliation'
        and public.has_user_permission('payments'))
    )
  on conflict (notification_id, user_id) do nothing;

  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.get_crm_notifications(integer, integer) from public, anon;
revoke all on function public.mark_crm_notification_read(bigint) from public, anon;
revoke all on function public.mark_all_crm_notifications_read() from public, anon;
grant execute on function public.get_crm_notifications(integer, integer) to authenticated;
grant execute on function public.mark_crm_notification_read(bigint) to authenticated;
grant execute on function public.mark_all_crm_notifications_read() to authenticated;

commit;
