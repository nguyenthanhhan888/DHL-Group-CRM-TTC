create schema if not exists private;

create table if not exists public.role_permissions (
  role text primary key,
  permissions text[] not null default '{}'::text[]
);

create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete restrict,
  display_name text,
  phone text,
  email text,
  status text not null default 'pending_profile',
  note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_profiles_status_check
    check (status in ('active', 'locked', 'pending_profile'))
);

create table if not exists public.user_facebook_accounts (
  id bigint primary key generated always as identity,
  user_id uuid not null references public.user_profiles(user_id) on delete restrict,
  facebook_id text,
  facebook_url_original text not null,
  facebook_url_normalized text,
  facebook_id_status text not null default 'pending',
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete restrict,
  is_primary boolean not null default false,
  note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_facebook_accounts_id_digits_check
    check (facebook_id is null or facebook_id ~ '^[0-9]+$'),
  constraint user_facebook_accounts_status_check
    check (facebook_id_status in ('resolved', 'pending', 'failed', 'manual_verified'))
);

create table if not exists public.customer_user_links (
  id bigint primary key generated always as identity,
  user_id uuid not null references public.user_profiles(user_id) on delete restrict,
  customer_id bigint not null references public.customers(id) on delete restrict,
  kiosk_id bigint references public.kiosks(id) on delete restrict,
  link_type text not null default 'owner',
  status text not null default 'pending',
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete restrict,
  rejection_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_user_links_type_check
    check (link_type in ('owner', 'manager', 'billing_contact', 'ttc_actor')),
  constraint customer_user_links_status_check
    check (status in ('pending', 'approved', 'rejected', 'revoked'))
);

create table if not exists public.wallets (
  user_id uuid primary key references public.user_profiles(user_id) on delete restrict,
  balance numeric(14, 2) not null default 0,
  total_earned numeric(14, 2) not null default 0,
  total_spent numeric(14, 2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wallets_balance_non_negative_check check (balance >= 0),
  constraint wallets_totals_non_negative_check check (total_earned >= 0 and total_spent >= 0)
);

create table if not exists public.wallet_ledger (
  id bigint primary key generated always as identity,
  wallet_user_id uuid not null references public.wallets(user_id) on delete restrict,
  actor_id uuid references auth.users(id) on delete restrict,
  actor_type text not null default 'system',
  transaction_type text not null,
  amount numeric(14, 2) not null,
  balance_before numeric(14, 2) not null,
  balance_after numeric(14, 2) not null,
  related_table text,
  related_id text,
  idempotency_key text,
  description text,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint wallet_ledger_amount_non_zero_check check (amount <> 0),
  constraint wallet_ledger_actor_type_check
    check (actor_type in ('user', 'staff', 'system')),
  constraint wallet_ledger_transaction_type_check
    check (transaction_type in (
      'earn_task',
      'spend_campaign',
      'bonus_signup',
      'admin_adjustment',
      'refund_campaign',
      'spend_kiosk',
      'refund_kiosk'
    ))
);

create table if not exists public.ttc_interaction_types (
  code text primary key,
  label text not null,
  unit_cost numeric(14, 2) not null default 0,
  worker_reward numeric(14, 2) not null default 0,
  min_quantity integer not null default 1,
  max_quantity integer not null default 1000,
  hold_seconds integer not null default 0,
  is_active boolean not null default true,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ttc_interaction_types_code_check
    check (code in ('like', 'reaction', 'comment', 'share', 'follow', 'join_group')),
  constraint ttc_interaction_types_amount_check
    check (unit_cost >= 0 and worker_reward >= 0),
  constraint ttc_interaction_types_quantity_check
    check (min_quantity > 0 and max_quantity >= min_quantity)
);

create table if not exists public.ttc_campaigns (
  id bigint primary key generated always as identity,
  owner_user_id uuid not null references public.user_profiles(user_id) on delete restrict,
  interaction_type_code text not null references public.ttc_interaction_types(code) on delete restrict,
  target_url text not null,
  target_facebook_id text,
  target_label text,
  comment_options jsonb not null default '[]'::jsonb,
  target_quantity integer not null,
  unit_cost numeric(14, 2) not null,
  worker_reward numeric(14, 2) not null,
  reserved_amount numeric(14, 2) not null default 0,
  spent_amount numeric(14, 2) not null default 0,
  refunded_amount numeric(14, 2) not null default 0,
  completed_count integer not null default 0,
  status text not null default 'queued',
  created_by_admin uuid references auth.users(id) on delete restrict,
  admin_reason text,
  idempotency_key text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ttc_campaigns_status_check
    check (status in ('draft', 'queued', 'running', 'paused', 'completed', 'cancelled', 'failed')),
  constraint ttc_campaigns_quantity_check
    check (target_quantity > 0 and completed_count >= 0 and completed_count <= target_quantity),
  constraint ttc_campaigns_amount_check
    check (
      unit_cost >= 0
      and worker_reward >= 0
      and reserved_amount >= 0
      and spent_amount >= 0
      and refunded_amount >= 0
    ),
  constraint ttc_campaigns_target_facebook_id_digits_check
    check (target_facebook_id is null or target_facebook_id ~ '^[0-9]+$')
);

create table if not exists public.ttc_tasks (
  id bigint primary key generated always as identity,
  campaign_id bigint not null references public.ttc_campaigns(id) on delete restrict,
  sequence_no integer not null,
  assignee_user_id uuid references public.user_profiles(user_id) on delete restrict,
  worker_facebook_account_id bigint references public.user_facebook_accounts(id) on delete restrict,
  worker_facebook_id text,
  status text not null default 'available',
  claimed_at timestamptz,
  submitted_at timestamptz,
  verified_at timestamptz,
  verified_by uuid references auth.users(id) on delete restrict,
  expires_at timestamptz,
  evidence jsonb not null default '{}'::jsonb,
  verification_result jsonb not null default '{}'::jsonb,
  rejection_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ttc_tasks_sequence_positive_check check (sequence_no > 0),
  constraint ttc_tasks_worker_facebook_id_digits_check
    check (worker_facebook_id is null or worker_facebook_id ~ '^[0-9]+$'),
  constraint ttc_tasks_status_check
    check (status in ('available', 'assigned', 'submitted', 'verifying', 'completed', 'rejected', 'expired'))
);

create table if not exists public.ttc_task_check_logs (
  id bigint primary key generated always as identity,
  task_id bigint not null references public.ttc_tasks(id) on delete restrict,
  campaign_id bigint not null references public.ttc_campaigns(id) on delete restrict,
  actor_id uuid references auth.users(id) on delete restrict,
  check_type text not null,
  result text not null,
  before_status text,
  after_status text,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint ttc_task_check_logs_type_check
    check (check_type in ('auto', 'manual', 'user_submit', 'system')),
  constraint ttc_task_check_logs_result_check
    check (result in ('pending', 'success', 'failed', 'manual_review'))
);

create index if not exists user_profiles_status_idx
  on public.user_profiles(status);
create unique index if not exists user_facebook_accounts_facebook_id_key
  on public.user_facebook_accounts(facebook_id)
  where facebook_id is not null;
create unique index if not exists user_facebook_accounts_one_primary_idx
  on public.user_facebook_accounts(user_id)
  where is_primary = true;
create index if not exists user_facebook_accounts_user_status_idx
  on public.user_facebook_accounts(user_id, facebook_id_status);
create unique index if not exists customer_user_links_active_unique_idx
  on public.customer_user_links(user_id, customer_id, coalesce(kiosk_id, -1))
  where status in ('pending', 'approved');
create index if not exists customer_user_links_customer_idx
  on public.customer_user_links(customer_id, status);
create index if not exists wallet_ledger_wallet_created_idx
  on public.wallet_ledger(wallet_user_id, created_at desc);
create unique index if not exists wallet_ledger_idempotency_key_idx
  on public.wallet_ledger(wallet_user_id, idempotency_key)
  where idempotency_key is not null;
create unique index if not exists ttc_campaigns_owner_idempotency_key_idx
  on public.ttc_campaigns(owner_user_id, idempotency_key)
  where idempotency_key is not null;
create index if not exists ttc_campaigns_owner_status_idx
  on public.ttc_campaigns(owner_user_id, status, created_at desc);
create index if not exists ttc_campaigns_status_type_idx
  on public.ttc_campaigns(status, interaction_type_code, created_at desc);
create unique index if not exists ttc_tasks_campaign_sequence_key
  on public.ttc_tasks(campaign_id, sequence_no);
create index if not exists ttc_tasks_available_idx
  on public.ttc_tasks(campaign_id, status, sequence_no)
  where status = 'available';
create index if not exists ttc_tasks_assignee_status_idx
  on public.ttc_tasks(assignee_user_id, status, updated_at desc);
create unique index if not exists ttc_tasks_campaign_worker_active_key
  on public.ttc_tasks(campaign_id, worker_facebook_id)
  where worker_facebook_id is not null
    and status in ('assigned', 'submitted', 'verifying', 'completed');
create index if not exists ttc_task_check_logs_task_created_idx
  on public.ttc_task_check_logs(task_id, created_at desc);
create index if not exists ttc_task_check_logs_campaign_created_idx
  on public.ttc_task_check_logs(campaign_id, created_at desc);

insert into public.ttc_interaction_types(code, label, unit_cost, worker_reward, min_quantity, max_quantity, hold_seconds)
values
  ('like', 'Like', 1, 1, 1, 1000, 0),
  ('reaction', 'Reaction', 1, 1, 1, 1000, 0),
  ('comment', 'Comment', 2, 1, 1, 500, 0),
  ('share', 'Share', 2, 1, 1, 500, 0),
  ('follow', 'Follow', 2, 1, 1, 500, 0),
  ('join_group', 'Join Group', 3, 2, 1, 300, 0)
on conflict (code) do nothing;

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

drop trigger if exists user_profiles_touch_updated_at on public.user_profiles;
create trigger user_profiles_touch_updated_at
before update on public.user_profiles
for each row execute function private.touch_updated_at();

drop trigger if exists user_facebook_accounts_touch_updated_at on public.user_facebook_accounts;
create trigger user_facebook_accounts_touch_updated_at
before update on public.user_facebook_accounts
for each row execute function private.touch_updated_at();

drop trigger if exists customer_user_links_touch_updated_at on public.customer_user_links;
create trigger customer_user_links_touch_updated_at
before update on public.customer_user_links
for each row execute function private.touch_updated_at();

drop trigger if exists wallets_touch_updated_at on public.wallets;
create trigger wallets_touch_updated_at
before update on public.wallets
for each row execute function private.touch_updated_at();

drop trigger if exists ttc_interaction_types_touch_updated_at on public.ttc_interaction_types;
create trigger ttc_interaction_types_touch_updated_at
before update on public.ttc_interaction_types
for each row execute function private.touch_updated_at();

drop trigger if exists ttc_campaigns_touch_updated_at on public.ttc_campaigns;
create trigger ttc_campaigns_touch_updated_at
before update on public.ttc_campaigns
for each row execute function private.touch_updated_at();

drop trigger if exists ttc_tasks_touch_updated_at on public.ttc_tasks;
create trigger ttc_tasks_touch_updated_at
before update on public.ttc_tasks
for each row execute function private.touch_updated_at();

alter table public.user_profiles enable row level security;
alter table public.user_facebook_accounts enable row level security;
alter table public.customer_user_links enable row level security;
alter table public.wallets enable row level security;
alter table public.wallet_ledger enable row level security;
alter table public.ttc_interaction_types enable row level security;
alter table public.ttc_campaigns enable row level security;
alter table public.ttc_tasks enable row level security;
alter table public.ttc_task_check_logs enable row level security;

create or replace function public.has_active_staff_permission(permission_input text default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.user_roles ur
    where ur.user_id = auth.uid()
      and ur.is_active = true
      and (
        lower(ur.role) = 'admin'
        or (
          nullif(trim(permission_input), '') is not null
          and exists (
            select 1
            from public.role_permissions rp
            where lower(rp.role) = lower(ur.role)
              and permission_input = any(rp.permissions)
          )
        )
      )
  );
$function$;

create or replace function private.assert_ttc_staff(permission_input text default 'admin-ttc')
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
    raise exception 'Bạn phải đăng nhập.' using errcode = '42501';
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
          and permission_input = any(rp.permissions)
      )
    );

  if not found then
    raise exception 'Không có quyền quản trị TTC.' using errcode = '42501';
  end if;

  return actor;
end;
$function$;

create or replace function private.ensure_wallet(wallet_user_id_input uuid)
returns public.wallets
language plpgsql
security definer
set search_path = ''
as $function$
declare
  wallet_record public.wallets%rowtype;
begin
  insert into public.wallets(user_id)
  values (wallet_user_id_input)
  on conflict (user_id) do nothing;

  select *
  into wallet_record
  from public.wallets
  where user_id = wallet_user_id_input
  for update;

  if not found then
    raise exception 'Không tìm thấy ví xu.' using errcode = '23503';
  end if;

  return wallet_record;
end;
$function$;

create or replace function private.write_ttc_audit(
  module_input text,
  action_input text,
  entity_input text,
  record_id_input text,
  before_input jsonb,
  after_input jsonb,
  reason_input text
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if to_regclass('public.audit_logs') is null then
    return;
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
    auth.uid(),
    null,
    case when auth.uid() is null then 'system' else null end,
    null,
    module_input,
    entity_input,
    record_id_input,
    action_input,
    before_input,
    after_input,
    nullif(trim(reason_input), '')
  );
end;
$function$;

create or replace function private.post_wallet_ledger(
  wallet_user_id_input uuid,
  amount_input numeric,
  transaction_type_input text,
  related_table_input text default null,
  related_id_input text default null,
  idempotency_key_input text default null,
  description_input text default null,
  reason_input text default null,
  metadata_input jsonb default '{}'::jsonb,
  actor_id_input uuid default auth.uid(),
  actor_type_input text default 'system'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  wallet_record public.wallets%rowtype;
  ledger_record public.wallet_ledger%rowtype;
  normalized_amount numeric(14, 2) := amount_input;
  normalized_key text := nullif(trim(idempotency_key_input), '');
  before_balance numeric(14, 2);
  after_balance numeric(14, 2);
begin
  if wallet_user_id_input is null then
    raise exception 'User ví là bắt buộc.' using errcode = '22023';
  end if;
  if normalized_amount is null or normalized_amount = 0 then
    raise exception 'Số xu giao dịch phải khác 0.' using errcode = '22023';
  end if;
  if transaction_type_input not in (
    'earn_task',
    'spend_campaign',
    'bonus_signup',
    'admin_adjustment',
    'refund_campaign',
    'spend_kiosk',
    'refund_kiosk'
  ) then
    raise exception 'Loại giao dịch ví không hợp lệ.' using errcode = '22023';
  end if;
  if actor_type_input not in ('user', 'staff', 'system') then
    raise exception 'Loại actor ví không hợp lệ.' using errcode = '22023';
  end if;

  if normalized_key is not null then
    select *
    into ledger_record
    from public.wallet_ledger
    where wallet_user_id = wallet_user_id_input
      and idempotency_key = normalized_key;
    if found then
      return jsonb_build_object(
        'wallet', (
          select to_jsonb(w)
          from public.wallets w
          where w.user_id = wallet_user_id_input
        ),
        'ledger', to_jsonb(ledger_record),
        'already_processed', true
      );
    end if;
  end if;

  wallet_record := private.ensure_wallet(wallet_user_id_input);
  before_balance := wallet_record.balance;
  after_balance := before_balance + normalized_amount;
  if after_balance < 0 then
    raise exception 'Số dư xu không đủ.' using errcode = '23514';
  end if;

  update public.wallets
  set
    balance = after_balance,
    total_earned = total_earned + case when normalized_amount > 0 then normalized_amount else 0 end,
    total_spent = total_spent + case when normalized_amount < 0 then abs(normalized_amount) else 0 end,
    updated_at = now()
  where user_id = wallet_user_id_input
  returning * into wallet_record;

  insert into public.wallet_ledger(
    wallet_user_id,
    actor_id,
    actor_type,
    transaction_type,
    amount,
    balance_before,
    balance_after,
    related_table,
    related_id,
    idempotency_key,
    description,
    reason,
    metadata
  )
  values(
    wallet_user_id_input,
    actor_id_input,
    actor_type_input,
    transaction_type_input,
    normalized_amount,
    before_balance,
    after_balance,
    nullif(trim(related_table_input), ''),
    nullif(trim(related_id_input), ''),
    normalized_key,
    nullif(trim(description_input), ''),
    nullif(trim(reason_input), ''),
    coalesce(metadata_input, '{}'::jsonb)
  )
  returning * into ledger_record;

  perform private.write_ttc_audit(
    'Wallet',
    'post_ledger',
    'wallet_ledger',
    ledger_record.id::text,
    jsonb_build_object('balance', before_balance),
    jsonb_build_object(
      'wallet_user_id', wallet_user_id_input,
      'amount', normalized_amount,
      'balance_after', after_balance,
      'transaction_type', transaction_type_input,
      'related_table', related_table_input,
      'related_id', related_id_input
    ),
    reason_input
  );

  return jsonb_build_object(
    'wallet', to_jsonb(wallet_record),
    'ledger', to_jsonb(ledger_record),
    'already_processed', false
  );
end;
$function$;

create or replace function public.get_current_app_profile()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  staff_record public.user_roles%rowtype;
  user_record public.user_profiles%rowtype;
  wallet_record public.wallets%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Bạn phải đăng nhập.' using errcode = '42501';
  end if;

  select *
  into staff_record
  from public.user_roles ur
  where ur.user_id = auth.uid();

  if found then
    return jsonb_build_object(
      'profile_type', 'staff',
      'user_id', staff_record.user_id,
      'username', staff_record.username,
      'display_name', staff_record.display_name,
      'role', staff_record.role,
      'is_active', staff_record.is_active
    );
  end if;

  select *
  into user_record
  from public.user_profiles up
  where up.user_id = auth.uid();

  if not found then
    return null;
  end if;

  select *
  into wallet_record
  from public.wallets w
  where w.user_id = auth.uid();

  return jsonb_build_object(
    'profile_type', 'user',
    'user_id', user_record.user_id,
    'username', user_record.email,
    'display_name', user_record.display_name,
    'phone', user_record.phone,
    'email', user_record.email,
    'role', 'user',
    'status', user_record.status,
    'is_active', user_record.status = 'active',
    'wallet', case when wallet_record.user_id is null then null else to_jsonb(wallet_record) end
  );
end;
$function$;

create or replace function public.get_my_wallet()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  profile_record public.user_profiles%rowtype;
  wallet_record public.wallets%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Bạn phải đăng nhập để xem ví xu.' using errcode = '42501';
  end if;

  select *
  into profile_record
  from public.user_profiles
  where user_id = auth.uid()
    and status <> 'locked';
  if not found then
    raise exception 'Không tìm thấy hồ sơ user.' using errcode = '42501';
  end if;

  wallet_record := private.ensure_wallet(auth.uid());
  return to_jsonb(wallet_record);
end;
$function$;

create or replace function public.get_my_wallet_ledger(
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
  normalized_size integer := least(greatest(coalesce(page_size, 25), 1), 100);
  total_count bigint;
  rows_json jsonb;
begin
  if auth.uid() is null then
    raise exception 'Bạn phải đăng nhập để xem lịch sử ví.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.user_profiles up
    where up.user_id = auth.uid()
      and up.status <> 'locked'
  ) then
    raise exception 'Không tìm thấy hồ sơ user.' using errcode = '42501';
  end if;

  select count(*)
  into total_count
  from public.wallet_ledger wl
  where wl.wallet_user_id = auth.uid();

  select coalesce(jsonb_agg(to_jsonb(row_item) order by row_item.created_at desc), '[]'::jsonb)
  into rows_json
  from (
    select *
    from public.wallet_ledger wl
    where wl.wallet_user_id = auth.uid()
    order by wl.created_at desc, wl.id desc
    limit normalized_size
    offset (normalized_page - 1) * normalized_size
  ) row_item;

  return jsonb_build_object(
    'rows', rows_json,
    'total', total_count,
    'page', normalized_page,
    'pageSize', normalized_size
  );
end;
$function$;

create or replace function public.admin_post_wallet_ledger(
  wallet_user_id_input uuid,
  amount_input numeric,
  transaction_type_input text default 'admin_adjustment',
  related_table_input text default null,
  related_id_input text default null,
  idempotency_key_input text default null,
  description_input text default null,
  reason_input text default null,
  metadata_input jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor public.user_roles%rowtype;
begin
  actor := private.assert_ttc_staff('admin-ttc');
  if nullif(trim(reason_input), '') is null then
    raise exception 'Lý do cộng/trừ xu là bắt buộc.' using errcode = '22023';
  end if;
  if transaction_type_input <> 'admin_adjustment' then
    raise exception 'Admin chỉ được dùng loại admin_adjustment qua RPC này.' using errcode = '22023';
  end if;

  return private.post_wallet_ledger(
    wallet_user_id_input,
    amount_input,
    transaction_type_input,
    related_table_input,
    related_id_input,
    idempotency_key_input,
    description_input,
    reason_input,
    metadata_input,
    actor.user_id,
    'staff'
  );
end;
$function$;

create or replace function public.create_ttc_campaign(
  interaction_type_input text,
  target_url_input text,
  target_quantity_input integer,
  idempotency_key_input text,
  target_facebook_id_input text default null,
  target_label_input text default null,
  comment_options_input jsonb default '[]'::jsonb,
  metadata_input jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  profile_record public.user_profiles%rowtype;
  type_record public.ttc_interaction_types%rowtype;
  campaign_record public.ttc_campaigns%rowtype;
  ledger_result jsonb;
  task_index integer;
  normalized_key text := nullif(trim(idempotency_key_input), '');
  total_cost numeric(14, 2);
begin
  if auth.uid() is null then
    raise exception 'Bạn phải đăng nhập để tạo chiến dịch.' using errcode = '42501';
  end if;
  if normalized_key is null then
    raise exception 'idempotency_key là bắt buộc.' using errcode = '22023';
  end if;

  select *
  into campaign_record
  from public.ttc_campaigns
  where owner_user_id = auth.uid()
    and idempotency_key = normalized_key;
  if found then
    return jsonb_build_object('campaign', to_jsonb(campaign_record), 'already_processed', true);
  end if;

  select *
  into profile_record
  from public.user_profiles
  where user_id = auth.uid()
    and status = 'active';
  if not found then
    raise exception 'Hồ sơ user chưa sẵn sàng để tạo chiến dịch TTC.' using errcode = '42501';
  end if;

  select *
  into type_record
  from public.ttc_interaction_types
  where code = interaction_type_input
    and is_active = true;
  if not found then
    raise exception 'Loại tương tác TTC không hợp lệ hoặc đã tắt.' using errcode = '22023';
  end if;
  if target_quantity_input < type_record.min_quantity or target_quantity_input > type_record.max_quantity then
    raise exception 'Số lượng nhiệm vụ không nằm trong giới hạn cấu hình.' using errcode = '22023';
  end if;
  if nullif(trim(target_url_input), '') is null then
    raise exception 'Link mục tiêu là bắt buộc.' using errcode = '22023';
  end if;
  if target_facebook_id_input is not null and target_facebook_id_input !~ '^[0-9]+$' then
    raise exception 'Facebook ID mục tiêu chỉ được chứa chữ số.' using errcode = '22023';
  end if;

  total_cost := type_record.unit_cost * target_quantity_input;

  insert into public.ttc_campaigns(
    owner_user_id,
    interaction_type_code,
    target_url,
    target_facebook_id,
    target_label,
    comment_options,
    target_quantity,
    unit_cost,
    worker_reward,
    reserved_amount,
    status,
    idempotency_key,
    metadata
  )
  values(
    auth.uid(),
    type_record.code,
    trim(target_url_input),
    nullif(trim(target_facebook_id_input), ''),
    nullif(trim(target_label_input), ''),
    coalesce(comment_options_input, '[]'::jsonb),
    target_quantity_input,
    type_record.unit_cost,
    type_record.worker_reward,
    total_cost,
    'queued',
    normalized_key,
    coalesce(metadata_input, '{}'::jsonb)
  )
  returning * into campaign_record;

  ledger_result := private.post_wallet_ledger(
    auth.uid(),
    -total_cost,
    'spend_campaign',
    'ttc_campaigns',
    campaign_record.id::text,
    'ttc_campaign:create:' || normalized_key,
    'Tạo chiến dịch TTC #' || campaign_record.id,
    'Tạo chiến dịch TTC',
    jsonb_build_object('campaign_id', campaign_record.id, 'interaction_type', type_record.code),
    auth.uid(),
    'user'
  );

  for task_index in 1..target_quantity_input loop
    insert into public.ttc_tasks(campaign_id, sequence_no)
    values (campaign_record.id, task_index);
  end loop;

  perform private.write_ttc_audit(
    'TTC',
    'create_campaign',
    'ttc_campaigns',
    campaign_record.id::text,
    null,
    to_jsonb(campaign_record),
    'Tạo chiến dịch TTC'
  );

  return jsonb_build_object(
    'campaign', to_jsonb(campaign_record),
    'wallet', ledger_result->'wallet',
    'task_count', target_quantity_input,
    'already_processed', false
  );
end;
$function$;

create or replace function public.claim_ttc_task(
  campaign_id_input bigint,
  facebook_account_id_input bigint,
  idempotency_key_input text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  profile_record public.user_profiles%rowtype;
  account_record public.user_facebook_accounts%rowtype;
  campaign_record public.ttc_campaigns%rowtype;
  task_record public.ttc_tasks%rowtype;
  normalized_key text := nullif(trim(idempotency_key_input), '');
begin
  if auth.uid() is null then
    raise exception 'Bạn phải đăng nhập để nhận nhiệm vụ.' using errcode = '42501';
  end if;
  if normalized_key is null then
    raise exception 'idempotency_key là bắt buộc.' using errcode = '22023';
  end if;

  select *
  into task_record
  from public.ttc_tasks
  where assignee_user_id = auth.uid()
    and campaign_id = campaign_id_input
    and metadata->>'claim_idempotency_key' = normalized_key;
  if found then
    return jsonb_build_object('task', to_jsonb(task_record), 'already_processed', true);
  end if;

  select *
  into profile_record
  from public.user_profiles
  where user_id = auth.uid()
    and status = 'active';
  if not found then
    raise exception 'Hồ sơ user chưa sẵn sàng để nhận nhiệm vụ TTC.' using errcode = '42501';
  end if;

  select *
  into account_record
  from public.user_facebook_accounts
  where id = facebook_account_id_input
    and user_id = auth.uid()
    and facebook_id is not null
    and facebook_id_status in ('resolved', 'manual_verified')
  for update;
  if not found then
    raise exception 'Tài khoản Facebook chưa được xác minh.' using errcode = '42501';
  end if;

  select *
  into campaign_record
  from public.ttc_campaigns
  where id = campaign_id_input
    and status in ('queued', 'running')
  for update;
  if not found then
    raise exception 'Chiến dịch không còn nhiệm vụ khả dụng.' using errcode = '22023';
  end if;
  if campaign_record.owner_user_id = auth.uid() then
    raise exception 'Không được tự làm nhiệm vụ của chiến dịch mình tạo.' using errcode = '23514';
  end if;
  if exists (
    select 1
    from public.ttc_tasks existing
    where existing.campaign_id = campaign_id_input
      and existing.worker_facebook_id = account_record.facebook_id
      and existing.status in ('assigned', 'submitted', 'verifying', 'completed')
  ) then
    raise exception 'Facebook ID này đã nhận hoặc hoàn thành nhiệm vụ trong chiến dịch.' using errcode = '23505';
  end if;

  select *
  into task_record
  from public.ttc_tasks
  where campaign_id = campaign_id_input
    and status = 'available'
  order by sequence_no
  limit 1
  for update skip locked;
  if not found then
    raise exception 'Không còn nhiệm vụ trống trong chiến dịch này.' using errcode = '22023';
  end if;

  update public.ttc_tasks
  set
    status = 'assigned',
    assignee_user_id = auth.uid(),
    worker_facebook_account_id = account_record.id,
    worker_facebook_id = account_record.facebook_id,
    claimed_at = now(),
    expires_at = case
      when campaign_record.interaction_type_code is not null then now() + make_interval(hours => 24)
      else null
    end,
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('claim_idempotency_key', normalized_key)
  where id = task_record.id
  returning * into task_record;

  update public.ttc_campaigns
  set status = case when status = 'queued' then 'running' else status end
  where id = campaign_record.id;

  insert into public.ttc_task_check_logs(task_id, campaign_id, actor_id, check_type, result, before_status, after_status, reason)
  values(task_record.id, campaign_record.id, auth.uid(), 'system', 'pending', 'available', 'assigned', 'User nhận nhiệm vụ');

  return jsonb_build_object('task', to_jsonb(task_record), 'already_processed', false);
end;
$function$;

create or replace function public.submit_ttc_task(
  task_id_input bigint,
  evidence_input jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  task_record public.ttc_tasks%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Bạn phải đăng nhập để gửi nhiệm vụ.' using errcode = '42501';
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
  if task_record.status not in ('assigned', 'submitted') then
    raise exception 'Nhiệm vụ không ở trạng thái có thể gửi.' using errcode = '22023';
  end if;

  update public.ttc_tasks
  set
    status = 'submitted',
    submitted_at = coalesce(submitted_at, now()),
    evidence = coalesce(evidence_input, '{}'::jsonb)
  where id = task_record.id
  returning * into task_record;

  insert into public.ttc_task_check_logs(task_id, campaign_id, actor_id, check_type, result, before_status, after_status, reason, metadata)
  values(task_record.id, task_record.campaign_id, auth.uid(), 'user_submit', 'pending', 'assigned', 'submitted', 'User gửi bằng chứng nhiệm vụ', coalesce(evidence_input, '{}'::jsonb));

  return jsonb_build_object('task', to_jsonb(task_record), 'credited', false);
end;
$function$;

create or replace function public.verify_ttc_task(
  task_id_input bigint,
  action_input text,
  reason_input text default null,
  metadata_input jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor public.user_roles%rowtype;
  task_record public.ttc_tasks%rowtype;
  before_task public.ttc_tasks%rowtype;
  campaign_record public.ttc_campaigns%rowtype;
  ledger_result jsonb := null;
  normalized_action text := lower(trim(action_input));
  next_status text;
  log_result text;
begin
  actor := private.assert_ttc_staff('admin-ttc');

  select *
  into before_task
  from public.ttc_tasks
  where id = task_id_input
  for update;
  if not found then
    raise exception 'Không tìm thấy nhiệm vụ TTC.' using errcode = '22023';
  end if;
  if before_task.status = 'completed' then
    return jsonb_build_object('task', to_jsonb(before_task), 'already_processed', true);
  end if;
  if before_task.status not in ('submitted', 'verifying') then
    raise exception 'Nhiệm vụ chưa được user gửi hoặc không thể xác minh.' using errcode = '22023';
  end if;

  select *
  into campaign_record
  from public.ttc_campaigns
  where id = before_task.campaign_id
  for update;

  if normalized_action = 'approve' then
    next_status := 'completed';
    log_result := 'success';
  elsif normalized_action = 'reject' then
    if nullif(trim(reason_input), '') is null then
      raise exception 'Lý do từ chối nhiệm vụ là bắt buộc.' using errcode = '22023';
    end if;
    next_status := 'rejected';
    log_result := 'failed';
  elsif normalized_action = 'manual_review' then
    next_status := 'verifying';
    log_result := 'manual_review';
  else
    raise exception 'Thao tác xác minh nhiệm vụ không hợp lệ.' using errcode = '22023';
  end if;

  update public.ttc_tasks
  set
    status = next_status,
    verified_at = case when next_status in ('completed', 'rejected') then now() else verified_at end,
    verified_by = actor.user_id,
    verification_result = coalesce(metadata_input, '{}'::jsonb),
    rejection_reason = case when next_status = 'rejected' then trim(reason_input) else null end
  where id = before_task.id
  returning * into task_record;

  if next_status = 'completed' then
    update public.ttc_campaigns
    set
      completed_count = completed_count + 1,
      spent_amount = spent_amount + campaign_record.unit_cost,
      status = case
        when completed_count + 1 >= target_quantity then 'completed'
        else 'running'
      end
    where id = campaign_record.id
    returning * into campaign_record;

    ledger_result := private.post_wallet_ledger(
      task_record.assignee_user_id,
      campaign_record.worker_reward,
      'earn_task',
      'ttc_tasks',
      task_record.id::text,
      'ttc_task:reward:' || task_record.id::text,
      'Thưởng nhiệm vụ TTC #' || task_record.id,
      coalesce(reason_input, 'Nhiệm vụ TTC đã xác minh thành công'),
      jsonb_build_object('task_id', task_record.id, 'campaign_id', campaign_record.id),
      actor.user_id,
      'staff'
    );
  end if;

  insert into public.ttc_task_check_logs(task_id, campaign_id, actor_id, check_type, result, before_status, after_status, reason, metadata)
  values(task_record.id, task_record.campaign_id, actor.user_id, 'manual', log_result, before_task.status, task_record.status, nullif(trim(reason_input), ''), coalesce(metadata_input, '{}'::jsonb));

  perform private.write_ttc_audit(
    'TTC',
    'verify_task_' || normalized_action,
    'ttc_tasks',
    task_record.id::text,
    to_jsonb(before_task),
    to_jsonb(task_record),
    reason_input
  );

  return jsonb_build_object(
    'task', to_jsonb(task_record),
    'campaign', to_jsonb(campaign_record),
    'wallet', ledger_result->'wallet',
    'credited', next_status = 'completed',
    'already_processed', false
  );
end;
$function$;

create or replace function public.cancel_ttc_campaign(
  campaign_id_input bigint,
  reason_input text,
  idempotency_key_input text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  campaign_record public.ttc_campaigns%rowtype;
  before_campaign public.ttc_campaigns%rowtype;
  actor public.user_roles%rowtype;
  is_staff boolean := false;
  refundable_amount numeric(14, 2);
  ledger_result jsonb := null;
  normalized_key text := nullif(trim(idempotency_key_input), '');
begin
  if auth.uid() is null then
    raise exception 'Bạn phải đăng nhập để hủy chiến dịch.' using errcode = '42501';
  end if;
  if nullif(trim(reason_input), '') is null then
    raise exception 'Lý do hủy chiến dịch là bắt buộc.' using errcode = '22023';
  end if;
  if normalized_key is null then
    raise exception 'idempotency_key là bắt buộc.' using errcode = '22023';
  end if;

  select *
  into before_campaign
  from public.ttc_campaigns
  where id = campaign_id_input
  for update;
  if not found then
    raise exception 'Không tìm thấy chiến dịch TTC.' using errcode = '22023';
  end if;
  if before_campaign.status = 'cancelled' then
    return jsonb_build_object('campaign', to_jsonb(before_campaign), 'already_processed', true);
  end if;

  begin
    actor := private.assert_ttc_staff('admin-ttc');
    is_staff := true;
  exception when insufficient_privilege then
    is_staff := false;
  end;

  if not is_staff and before_campaign.owner_user_id <> auth.uid() then
    raise exception 'Không có quyền hủy chiến dịch này.' using errcode = '42501';
  end if;
  if before_campaign.status in ('completed', 'failed') then
    raise exception 'Chiến dịch ở trạng thái kết thúc không thể hủy.' using errcode = '22023';
  end if;

  refundable_amount := greatest(
    before_campaign.reserved_amount - before_campaign.spent_amount - before_campaign.refunded_amount,
    0
  );

  update public.ttc_tasks
  set status = 'expired'
  where campaign_id = before_campaign.id
    and status in ('available', 'assigned');

  update public.ttc_campaigns
  set
    status = 'cancelled',
    refunded_amount = refunded_amount + refundable_amount
  where id = before_campaign.id
  returning * into campaign_record;

  if refundable_amount > 0 then
    ledger_result := private.post_wallet_ledger(
      campaign_record.owner_user_id,
      refundable_amount,
      'refund_campaign',
      'ttc_campaigns',
      campaign_record.id::text,
      'ttc_campaign:cancel:' || normalized_key,
      'Hoàn xu chiến dịch TTC #' || campaign_record.id,
      reason_input,
      jsonb_build_object('campaign_id', campaign_record.id),
      auth.uid(),
      case when is_staff then 'staff' else 'user' end
    );
  end if;

  perform private.write_ttc_audit(
    'TTC',
    'cancel_campaign',
    'ttc_campaigns',
    campaign_record.id::text,
    to_jsonb(before_campaign),
    to_jsonb(campaign_record),
    reason_input
  );

  return jsonb_build_object(
    'campaign', to_jsonb(campaign_record),
    'wallet', ledger_result->'wallet',
    'refunded_amount', refundable_amount,
    'already_processed', false
  );
end;
$function$;

drop policy if exists user_profiles_select_own_or_staff on public.user_profiles;
create policy user_profiles_select_own_or_staff
on public.user_profiles
for select
to authenticated
using (user_id = auth.uid() or public.has_active_staff_permission('admin-ttc'));

drop policy if exists user_profiles_update_own on public.user_profiles;
create policy user_profiles_update_own
on public.user_profiles
for update
to authenticated
using (user_id = auth.uid() and status <> 'locked')
with check (user_id = auth.uid() and status <> 'locked');

drop policy if exists user_facebook_accounts_select_own_or_staff on public.user_facebook_accounts;
create policy user_facebook_accounts_select_own_or_staff
on public.user_facebook_accounts
for select
to authenticated
using (user_id = auth.uid() or public.has_active_staff_permission('admin-ttc'));

drop policy if exists customer_user_links_select_own_or_staff on public.customer_user_links;
create policy customer_user_links_select_own_or_staff
on public.customer_user_links
for select
to authenticated
using (user_id = auth.uid() or public.has_active_staff_permission('admin-ttc'));

drop policy if exists wallets_select_own_or_staff on public.wallets;
create policy wallets_select_own_or_staff
on public.wallets
for select
to authenticated
using (user_id = auth.uid() or public.has_active_staff_permission('admin-ttc'));

drop policy if exists wallet_ledger_select_own_or_staff on public.wallet_ledger;
create policy wallet_ledger_select_own_or_staff
on public.wallet_ledger
for select
to authenticated
using (wallet_user_id = auth.uid() or public.has_active_staff_permission('admin-ttc'));

drop policy if exists ttc_interaction_types_select_authenticated on public.ttc_interaction_types;
create policy ttc_interaction_types_select_authenticated
on public.ttc_interaction_types
for select
to authenticated
using (true);

drop policy if exists ttc_campaigns_select_own_or_staff on public.ttc_campaigns;
create policy ttc_campaigns_select_own_or_staff
on public.ttc_campaigns
for select
to authenticated
using (owner_user_id = auth.uid() or public.has_active_staff_permission('admin-ttc'));

drop policy if exists ttc_tasks_select_related_or_staff on public.ttc_tasks;
create policy ttc_tasks_select_related_or_staff
on public.ttc_tasks
for select
to authenticated
using (
  assignee_user_id = auth.uid()
  or public.has_active_staff_permission('admin-ttc')
  or exists (
    select 1
    from public.ttc_campaigns c
    where c.id = ttc_tasks.campaign_id
      and c.owner_user_id = auth.uid()
  )
);

drop policy if exists ttc_task_check_logs_select_related_or_staff on public.ttc_task_check_logs;
create policy ttc_task_check_logs_select_related_or_staff
on public.ttc_task_check_logs
for select
to authenticated
using (
  public.has_active_staff_permission('admin-ttc')
  or exists (
    select 1
    from public.ttc_tasks t
    join public.ttc_campaigns c on c.id = t.campaign_id
    where t.id = ttc_task_check_logs.task_id
      and (t.assignee_user_id = auth.uid() or c.owner_user_id = auth.uid())
  )
);

revoke all on table public.user_profiles from public, anon;
revoke all on table public.user_facebook_accounts from public, anon;
revoke all on table public.customer_user_links from public, anon;
revoke all on table public.wallets from public, anon;
revoke all on table public.wallet_ledger from public, anon;
revoke all on table public.ttc_interaction_types from public, anon;
revoke all on table public.ttc_campaigns from public, anon;
revoke all on table public.ttc_tasks from public, anon;
revoke all on table public.ttc_task_check_logs from public, anon;

grant select on table public.user_profiles to authenticated;
grant select on table public.user_facebook_accounts to authenticated;
grant select on table public.customer_user_links to authenticated;
grant select on table public.wallets to authenticated;
grant select on table public.wallet_ledger to authenticated;
grant select on table public.ttc_interaction_types to authenticated;
grant select on table public.ttc_campaigns to authenticated;
grant select on table public.ttc_tasks to authenticated;
grant select on table public.ttc_task_check_logs to authenticated;

revoke all on function public.has_active_staff_permission(text) from public, anon, authenticated;
grant execute on function public.has_active_staff_permission(text) to authenticated;
revoke all on function public.get_current_app_profile() from public, anon, authenticated;
grant execute on function public.get_current_app_profile() to authenticated;
revoke all on function public.get_my_wallet() from public, anon, authenticated;
grant execute on function public.get_my_wallet() to authenticated;
revoke all on function public.get_my_wallet_ledger(integer, integer) from public, anon, authenticated;
grant execute on function public.get_my_wallet_ledger(integer, integer) to authenticated;
revoke all on function public.admin_post_wallet_ledger(uuid, numeric, text, text, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.admin_post_wallet_ledger(uuid, numeric, text, text, text, text, text, text, jsonb) to authenticated;
revoke all on function public.create_ttc_campaign(text, text, integer, text, text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.create_ttc_campaign(text, text, integer, text, text, text, jsonb, jsonb) to authenticated;
revoke all on function public.claim_ttc_task(bigint, bigint, text) from public, anon, authenticated;
grant execute on function public.claim_ttc_task(bigint, bigint, text) to authenticated;
revoke all on function public.submit_ttc_task(bigint, jsonb) from public, anon, authenticated;
grant execute on function public.submit_ttc_task(bigint, jsonb) to authenticated;
revoke all on function public.verify_ttc_task(bigint, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.verify_ttc_task(bigint, text, text, jsonb) to authenticated;
revoke all on function public.cancel_ttc_campaign(bigint, text, text) from public, anon, authenticated;
grant execute on function public.cancel_ttc_campaign(bigint, text, text) to authenticated;

notify pgrst, 'reload schema';
