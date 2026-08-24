create table if not exists public.ttc_checker_accounts (
  id bigint primary key generated always as identity,
  checker_key text not null unique,
  label text,
  status text not null default 'offline',
  capabilities text[] not null default '{}'::text[],
  max_jobs_per_hour integer not null default 60,
  last_seen_at timestamptz,
  last_job_at timestamptz,
  paused_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ttc_checker_accounts_status_check
    check (status in ('offline', 'online', 'busy', 'paused', 'checkpoint'))
);
create table if not exists public.ttc_verify_jobs (
  id bigint primary key generated always as identity,
  task_id bigint not null references public.ttc_tasks(id) on delete cascade,
  campaign_id bigint not null references public.ttc_campaigns(id) on delete cascade,
  assignee_user_id uuid not null,
  action_type text not null,
  target_url text not null,
  target_facebook_id text,
  target_label text,
  worker_facebook_id text,
  worker_facebook_urls text[] not null default '{}'::text[],
  worker_facebook_usernames text[] not null default '{}'::text[],
  worker_facebook_names text[] not null default '{}'::text[],
  batch_key text not null,
  status text not null default 'queued',
  priority integer not null default 0,
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  checker_account_id bigint references public.ttc_checker_accounts(id),
  claimed_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  estimated_wait_seconds integer,
  last_error text,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ttc_verify_jobs_status_check
    check (status in ('queued', 'batched', 'claimed', 'verifying', 'passed', 'failed', 'needs_review', 'expired', 'cancelled'))
);
create unique index if not exists ttc_verify_jobs_one_open_task
  on public.ttc_verify_jobs(task_id)
  where status in ('queued', 'batched', 'claimed', 'verifying');
create index if not exists ttc_verify_jobs_pick_idx
  on public.ttc_verify_jobs(status, next_attempt_at, priority desc, created_at);
create index if not exists ttc_verify_jobs_batch_idx
  on public.ttc_verify_jobs(batch_key, status);
create index if not exists ttc_verify_jobs_assignee_idx
  on public.ttc_verify_jobs(assignee_user_id, created_at desc);
create table if not exists public.ttc_target_scans (
  id bigint primary key generated always as identity,
  batch_key text not null,
  action_type text not null,
  target_url text not null,
  target_facebook_id text,
  target_label text,
  checker_account_id bigint references public.ttc_checker_accounts(id),
  status text not null default 'running',
  scanned_at timestamptz,
  matched_entities jsonb not null default '[]'::jsonb,
  evidence_ref text,
  evidence_summary jsonb not null default '{}'::jsonb,
  error_reason text,
  created_at timestamptz not null default now(),
  constraint ttc_target_scans_status_check
    check (status in ('running', 'passed', 'partial', 'failed'))
);
create index if not exists ttc_target_scans_batch_idx
  on public.ttc_target_scans(batch_key, scanned_at desc);
create table if not exists public.ttc_job_matches (
  id bigint primary key generated always as identity,
  job_id bigint not null references public.ttc_verify_jobs(id) on delete cascade,
  scan_id bigint references public.ttc_target_scans(id) on delete set null,
  match_confidence numeric(5, 2) not null default 0,
  match_signals jsonb not null default '{}'::jsonb,
  matched_entity jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists ttc_job_matches_job_idx
  on public.ttc_job_matches(job_id, created_at desc);
drop trigger if exists ttc_checker_accounts_touch_updated_at on public.ttc_checker_accounts;
create trigger ttc_checker_accounts_touch_updated_at
before update on public.ttc_checker_accounts
for each row execute function private.touch_updated_at();
drop trigger if exists ttc_verify_jobs_touch_updated_at on public.ttc_verify_jobs;
create trigger ttc_verify_jobs_touch_updated_at
before update on public.ttc_verify_jobs
for each row execute function private.touch_updated_at();
alter table public.ttc_checker_accounts enable row level security;
alter table public.ttc_verify_jobs enable row level security;
alter table public.ttc_target_scans enable row level security;
alter table public.ttc_job_matches enable row level security;
drop policy if exists ttc_verify_jobs_select_own on public.ttc_verify_jobs;
create policy ttc_verify_jobs_select_own
on public.ttc_verify_jobs
for select
to authenticated
using (assignee_user_id = auth.uid() or public.has_active_staff_permission('admin-ttc'));
drop policy if exists ttc_checker_accounts_select_staff on public.ttc_checker_accounts;
create policy ttc_checker_accounts_select_staff
on public.ttc_checker_accounts
for select
to authenticated
using (public.has_active_staff_permission('admin-ttc'));
drop policy if exists ttc_target_scans_select_staff on public.ttc_target_scans;
create policy ttc_target_scans_select_staff
on public.ttc_target_scans
for select
to authenticated
using (public.has_active_staff_permission('admin-ttc'));
drop policy if exists ttc_job_matches_select_own_job on public.ttc_job_matches;
create policy ttc_job_matches_select_own_job
on public.ttc_job_matches
for select
to authenticated
using (
  public.has_active_staff_permission('admin-ttc')
  or
  exists (
    select 1
    from public.ttc_verify_jobs j
    where j.id = ttc_job_matches.job_id
      and j.assignee_user_id = auth.uid()
  )
);
revoke all on table public.ttc_checker_accounts from public, anon, authenticated;
revoke all on table public.ttc_verify_jobs from public, anon, authenticated;
revoke all on table public.ttc_target_scans from public, anon, authenticated;
revoke all on table public.ttc_job_matches from public, anon, authenticated;
grant select on table public.ttc_verify_jobs to authenticated;
grant select on table public.ttc_checker_accounts to authenticated;
grant select on table public.ttc_target_scans to authenticated;
grant select on table public.ttc_job_matches to authenticated;
grant all on table public.ttc_checker_accounts to service_role;
grant all on table public.ttc_verify_jobs to service_role;
grant all on table public.ttc_target_scans to service_role;
grant all on table public.ttc_job_matches to service_role;
grant usage, select on sequence public.ttc_checker_accounts_id_seq to service_role;
grant usage, select on sequence public.ttc_verify_jobs_id_seq to service_role;
grant usage, select on sequence public.ttc_target_scans_id_seq to service_role;
grant usage, select on sequence public.ttc_job_matches_id_seq to service_role;
create or replace function public.enqueue_ttc_verify_job(task_id_input bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  task_record public.ttc_tasks%rowtype;
  campaign_record public.ttc_campaigns%rowtype;
  facebook_account_record public.user_facebook_accounts%rowtype;
  profile_record public.user_profiles%rowtype;
  existing_job public.ttc_verify_jobs%rowtype;
  job_record public.ttc_verify_jobs%rowtype;
  normalized_target text;
  batch_key_value text;
  queued_count integer := 0;
  online_checker_count integer := 0;
  estimate_seconds integer := 120;
begin
  if auth.uid() is null then
    raise exception 'Bạn phải đăng nhập để gửi auto check.' using errcode = '42501';
  end if;

  select *
  into task_record
  from public.ttc_tasks
  where id = task_id_input
    and assignee_user_id = auth.uid()
  for update;
  if not found then
    raise exception 'Không tìm thấy nhiệm vụ của bạn.' using errcode = '42501';
  end if;

  if task_record.status = 'completed' then
    return jsonb_build_object(
      'queued', false,
      'alreadyProcessed', true,
      'message', 'Nhiệm vụ đã hoàn thành.'
    );
  end if;

  if task_record.status not in ('assigned', 'submitted', 'verifying') then
    raise exception 'Nhiệm vụ chưa ở trạng thái có thể auto check.' using errcode = '22023';
  end if;

  select *
  into campaign_record
  from public.ttc_campaigns
  where id = task_record.campaign_id
  for update;
  if not found then
    raise exception 'Không tìm thấy chiến dịch TTC.' using errcode = '22023';
  end if;

  if campaign_record.status not in ('queued', 'running') then
    raise exception 'Chiến dịch không còn nhận kết quả nhiệm vụ.' using errcode = '22023';
  end if;

  select *
  into existing_job
  from public.ttc_verify_jobs
  where task_id = task_record.id
    and status in ('queued', 'batched', 'claimed', 'verifying')
  order by created_at desc
  limit 1;

  if found then
    update public.ttc_tasks
    set status = 'verifying',
        submitted_at = coalesce(submitted_at, now())
    where id = task_record.id
      and status in ('assigned', 'submitted', 'verifying');

    return jsonb_build_object(
      'queued', true,
      'job', to_jsonb(existing_job),
      'estimatedWaitSeconds', coalesce(existing_job.estimated_wait_seconds, 120),
      'message', 'Nhiệm vụ đã nằm trong hàng chờ kiểm tra.'
    );
  end if;

  select *
  into facebook_account_record
  from public.user_facebook_accounts
  where id = task_record.worker_facebook_account_id;

  select *
  into profile_record
  from public.user_profiles
  where user_id = task_record.assignee_user_id;

  normalized_target := lower(regexp_replace(trim(campaign_record.target_url), '\s+', '', 'g'));
  batch_key_value := md5(normalized_target || ':' || campaign_record.interaction_type_code);

  select count(*)
  into queued_count
  from public.ttc_verify_jobs
  where status in ('queued', 'batched', 'claimed', 'verifying');

  select greatest(count(*), 1)
  into online_checker_count
  from public.ttc_checker_accounts
  where status in ('online', 'busy');

  estimate_seconds := greatest(30, least(900, 30 * ceil((queued_count + 1)::numeric / online_checker_count)::integer));

  update public.ttc_tasks
  set
    status = 'verifying',
    submitted_at = coalesce(submitted_at, now()),
    evidence = case
      when coalesce(evidence, '{}'::jsonb) = '{}'::jsonb
        then jsonb_build_object('submitted_from', 'verify_queue', 'queued_at', now())
      else evidence || jsonb_build_object('queued_at', now())
    end
  where id = task_record.id
  returning * into task_record;

  insert into public.ttc_verify_jobs(
    task_id,
    campaign_id,
    assignee_user_id,
    action_type,
    target_url,
    target_facebook_id,
    target_label,
    worker_facebook_id,
    worker_facebook_urls,
    worker_facebook_usernames,
    worker_facebook_names,
    batch_key,
    estimated_wait_seconds
  )
  values(
    task_record.id,
    task_record.campaign_id,
    task_record.assignee_user_id,
    regexp_replace(campaign_record.interaction_type_code, '^facebook_', ''),
    campaign_record.target_url,
    campaign_record.target_facebook_id,
    campaign_record.target_label,
    task_record.worker_facebook_id,
    array_remove(array[
      facebook_account_record.facebook_url_original,
      facebook_account_record.facebook_url_normalized,
      case
        when facebook_account_record.facebook_id is not null then 'https://www.facebook.com/profile.php?id=' || facebook_account_record.facebook_id
        else null
      end
    ], null),
    array_remove(array[
      nullif(lower(regexp_replace(coalesce(facebook_account_record.facebook_url_normalized, ''), '^https?://(www\.)?facebook\.com/([^/?#]+).*$','\2')), ''),
      nullif(lower(regexp_replace(coalesce(facebook_account_record.facebook_url_original, ''), '^https?://(www\.)?facebook\.com/([^/?#]+).*$','\2')), '')
    ], null),
    array_remove(array[
      nullif(facebook_account_record.metadata->>'facebook_name', ''),
      nullif(facebook_account_record.metadata->>'name', ''),
      nullif(profile_record.display_name, ''),
      nullif(profile_record.metadata->>'display_name', ''),
      nullif(profile_record.metadata->>'facebook_name', ''),
      nullif(profile_record.metadata->>'name', '')
    ], null),
    batch_key_value,
    estimate_seconds
  )
  returning * into job_record;

  insert into public.ttc_task_check_logs(task_id, campaign_id, actor_id, check_type, result, before_status, after_status, reason, metadata)
  values(
    task_record.id,
    task_record.campaign_id,
    auth.uid(),
    'auto',
    'pending',
    'submitted',
    'verifying',
    'User gửi nhiệm vụ vào hàng chờ auto check Facebook',
    jsonb_build_object('job_id', job_record.id, 'batch_key', job_record.batch_key)
  );

  return jsonb_build_object(
    'queued', true,
    'job', to_jsonb(job_record),
    'estimatedWaitSeconds', estimate_seconds,
    'message', 'Đang xếp hàng kiểm tra Facebook.'
  );
end;
$function$;
revoke all on function public.enqueue_ttc_verify_job(bigint) from public, anon, authenticated;
grant execute on function public.enqueue_ttc_verify_job(bigint) to authenticated;
create or replace function public.admin_update_ttc_verify_job(
  job_id_input bigint,
  action_input text,
  reason_input text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor public.user_roles%rowtype;
  job_record public.ttc_verify_jobs%rowtype;
  task_record public.ttc_tasks%rowtype;
  normalized_action text := lower(nullif(trim(action_input), ''));
  normalized_reason text := nullif(trim(reason_input), '');
begin
  actor := private.assert_ttc_staff('admin-ttc');

  select *
  into job_record
  from public.ttc_verify_jobs
  where id = job_id_input
  for update;
  if not found then
    raise exception 'Không tìm thấy verify job.' using errcode = '22023';
  end if;

  select *
  into task_record
  from public.ttc_tasks
  where id = job_record.task_id
  for update;

  if normalized_action = 'retry' then
    update public.ttc_verify_jobs
    set
      status = 'queued',
      checker_account_id = null,
      claimed_at = null,
      started_at = null,
      finished_at = null,
      next_attempt_at = now(),
      last_error = normalized_reason,
      updated_at = now()
    where id = job_record.id
    returning * into job_record;

    if found and task_record.status in ('submitted', 'verifying', 'rejected') then
      update public.ttc_tasks
      set
        status = 'verifying',
        rejection_reason = null,
        updated_at = now()
      where id = task_record.id
      returning * into task_record;
    end if;
  elsif normalized_action = 'cancel' then
    update public.ttc_verify_jobs
    set
      status = 'cancelled',
      finished_at = now(),
      last_error = normalized_reason,
      result = coalesce(result, '{}'::jsonb) || jsonb_build_object(
        'cancelled_by', actor.user_id,
        'cancelled_at', now(),
        'reason', normalized_reason
      ),
      updated_at = now()
    where id = job_record.id
    returning * into job_record;
  else
    raise exception 'Action verify job không hợp lệ.' using errcode = '22023';
  end if;

  insert into public.ttc_task_check_logs(task_id, campaign_id, actor_id, check_type, result, before_status, after_status, reason, metadata)
  values(
    job_record.task_id,
    job_record.campaign_id,
    actor.user_id,
    'manual',
    case when normalized_action = 'retry' then 'pending' else 'manual_review' end,
    task_record.status,
    coalesce(task_record.status, 'verifying'),
    coalesce(normalized_reason, 'Admin cập nhật verify job'),
    jsonb_build_object('job_id', job_record.id, 'action', normalized_action)
  );

  return jsonb_build_object('job', to_jsonb(job_record), 'task', to_jsonb(task_record));
end;
$function$;
revoke all on function public.admin_update_ttc_verify_job(bigint, text, text) from public, anon, authenticated;
grant execute on function public.admin_update_ttc_verify_job(bigint, text, text) to authenticated;
