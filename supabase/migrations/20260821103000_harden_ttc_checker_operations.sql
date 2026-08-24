alter table public.ttc_checker_accounts
  add column if not exists chrome_profile_id text,
  add column if not exists facebook_account_id text,
  add column if not exists current_session_id uuid,
  add column if not exists jobs_passed_today integer not null default 0,
  add column if not exists jobs_failed_today integer not null default 0,
  add column if not exists jobs_needs_review_today integer not null default 0,
  add column if not exists jobs_completed_lifetime integer not null default 0,
  add column if not exists jobs_failed_lifetime integer not null default 0,
  add column if not exists jobs_needs_review_lifetime integer not null default 0,
  add column if not exists counters_reset_at timestamptz not null default now();
alter table public.ttc_checker_accounts
  drop constraint if exists ttc_checker_accounts_status_check;
alter table public.ttc_checker_accounts
  add constraint ttc_checker_accounts_status_check
    check (status in ('offline', 'online', 'busy', 'paused', 'checkpoint', 'banned'));
create unique index if not exists ttc_checker_accounts_chrome_profile_unique
  on public.ttc_checker_accounts(chrome_profile_id)
  where chrome_profile_id is not null;
create unique index if not exists ttc_checker_accounts_facebook_account_unique
  on public.ttc_checker_accounts(facebook_account_id)
  where facebook_account_id is not null;
alter table public.ttc_verify_jobs
  add column if not exists checker_session_id uuid,
  add column if not exists error_code text;
alter table public.ttc_target_scans
  add column if not exists checker_session_id uuid,
  add column if not exists error_code text,
  add column if not exists scan_attempts integer not null default 1;
create table if not exists public.ttc_checker_sessions (
  id uuid primary key default gen_random_uuid(),
  checker_account_id bigint not null references public.ttc_checker_accounts(id) on delete cascade,
  checker_key text not null,
  chrome_profile_id text,
  facebook_account_id text,
  status text not null default 'online',
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  ended_at timestamptz,
  jobs_completed integer not null default 0,
  jobs_failed integer not null default 0,
  jobs_needs_review integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  constraint ttc_checker_sessions_status_check
    check (status in ('online', 'busy', 'paused', 'checkpoint', 'banned', 'offline', 'ended'))
);
create index if not exists ttc_checker_sessions_checker_idx
  on public.ttc_checker_sessions(checker_account_id, started_at desc);
alter table public.ttc_checker_sessions enable row level security;
drop policy if exists ttc_checker_sessions_select_staff on public.ttc_checker_sessions;
create policy ttc_checker_sessions_select_staff
on public.ttc_checker_sessions
for select
to authenticated
using (public.has_active_staff_permission('admin-ttc'));
revoke all on table public.ttc_checker_sessions from public, anon, authenticated;
grant select on table public.ttc_checker_sessions to authenticated;
grant all on table public.ttc_checker_sessions to service_role;
