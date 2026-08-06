create or replace function public.ensure_my_user_profile(
  display_name_input text default null,
  phone_input text default null,
  email_input text default null,
  metadata_input jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  profile_record public.user_profiles%rowtype;
  wallet_record public.wallets%rowtype;
  normalized_display_name text := nullif(trim(display_name_input), '');
  normalized_phone text := nullif(trim(phone_input), '');
  normalized_email text := nullif(lower(trim(email_input)), '');
  next_status text;
begin
  if auth.uid() is null then
    raise exception 'Bạn phải đăng nhập để tạo hồ sơ.' using errcode = '42501';
  end if;
  if normalized_phone is not null and normalized_phone !~ '^\+?[0-9 .()-]{9,20}$' then
    raise exception 'Số điện thoại không hợp lệ.' using errcode = '22023';
  end if;

  select *
  into profile_record
  from public.user_profiles
  where user_id = auth.uid()
  for update;

  if found and profile_record.status = 'locked' then
    raise exception 'Tài khoản user đã bị khóa.' using errcode = '42501';
  end if;

  next_status := case
    when normalized_display_name is not null and normalized_phone is not null then 'active'
    else 'pending_profile'
  end;

  insert into public.user_profiles(
    user_id,
    display_name,
    phone,
    email,
    status,
    metadata
  )
  values(
    auth.uid(),
    normalized_display_name,
    normalized_phone,
    normalized_email,
    next_status,
    coalesce(metadata_input, '{}'::jsonb)
  )
  on conflict (user_id) do update
  set
    display_name = coalesce(excluded.display_name, public.user_profiles.display_name),
    phone = coalesce(excluded.phone, public.user_profiles.phone),
    email = coalesce(excluded.email, public.user_profiles.email),
    status = case
      when public.user_profiles.status = 'locked' then public.user_profiles.status
      when coalesce(excluded.display_name, public.user_profiles.display_name) is not null
        and coalesce(excluded.phone, public.user_profiles.phone) is not null then 'active'
      else 'pending_profile'
    end,
    metadata = coalesce(public.user_profiles.metadata, '{}'::jsonb) || coalesce(excluded.metadata, '{}'::jsonb),
    updated_at = now()
  returning * into profile_record;

  wallet_record := private.ensure_wallet(auth.uid());

  perform private.write_ttc_audit(
    'User',
    'ensure_profile',
    'user_profiles',
    profile_record.user_id::text,
    null,
    jsonb_build_object(
      'user_id', profile_record.user_id,
      'status', profile_record.status,
      'has_phone', profile_record.phone is not null,
      'has_email', profile_record.email is not null
    ),
    'User cập nhật hồ sơ'
  );

  return jsonb_build_object(
    'profile', to_jsonb(profile_record),
    'wallet', to_jsonb(wallet_record)
  );
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
declare
  has_modern_shape boolean;
begin
  if to_regclass('public.audit_logs') is null then
    return;
  end if;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'audit_logs'
      and column_name in ('actor_type', 'entity', 'record_id')
    group by table_schema, table_name
    having count(*) = 3
  )
  into has_modern_shape;

  if has_modern_shape then
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
  else
    insert into public.audit_logs(
      actor_id,
      actor_name,
      actor_role,
      module,
      action,
      before,
      after,
      reason
    )
    values(
      auth.uid(),
      null,
      null,
      module_input,
      action_input,
      before_input,
      after_input,
      nullif(trim(reason_input), '')
    );
  end if;
end;
$function$;

create or replace function public.upsert_my_facebook_account(
  account_id_input bigint default null,
  facebook_url_original_input text default null,
  facebook_url_normalized_input text default null,
  facebook_id_input text default null,
  facebook_id_status_input text default null,
  is_primary_input boolean default false,
  note_input text default null,
  metadata_input jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  profile_record public.user_profiles%rowtype;
  existing_record public.user_facebook_accounts%rowtype;
  account_record public.user_facebook_accounts%rowtype;
  normalized_url_original text := nullif(trim(facebook_url_original_input), '');
  normalized_url text := nullif(trim(facebook_url_normalized_input), '');
  normalized_facebook_id text := nullif(regexp_replace(coalesce(facebook_id_input, ''), '[^0-9]', '', 'g'), '');
  normalized_status text := nullif(trim(facebook_id_status_input), '');
begin
  if auth.uid() is null then
    raise exception 'Bạn phải đăng nhập để cập nhật Facebook.' using errcode = '42501';
  end if;

  select *
  into profile_record
  from public.user_profiles
  where user_id = auth.uid()
    and status <> 'locked'
  for update;
  if not found then
    raise exception 'Vui lòng tạo hồ sơ user trước.' using errcode = '42501';
  end if;

  if normalized_url_original is null then
    raise exception 'Link Facebook là bắt buộc.' using errcode = '22023';
  end if;
  if normalized_facebook_id is null and normalized_status in ('resolved', 'manual_verified') then
    raise exception 'Facebook ID là bắt buộc khi trạng thái đã xác minh.' using errcode = '22023';
  end if;
  if normalized_facebook_id is not null and normalized_facebook_id !~ '^[0-9]+$' then
    raise exception 'Facebook ID chỉ được chứa chữ số.' using errcode = '22023';
  end if;

  normalized_status := coalesce(
    normalized_status,
    case when normalized_facebook_id is null then 'pending' else 'resolved' end
  );
  if normalized_status not in ('resolved', 'pending', 'failed', 'manual_verified') then
    raise exception 'Trạng thái Facebook ID không hợp lệ.' using errcode = '22023';
  end if;

  if account_id_input is not null then
    select *
    into existing_record
    from public.user_facebook_accounts
    where id = account_id_input
      and user_id = auth.uid()
    for update;
    if not found then
      raise exception 'Không tìm thấy tài khoản Facebook của bạn.' using errcode = '42501';
    end if;
  end if;

  if normalized_facebook_id is not null and exists (
    select 1
    from public.user_facebook_accounts ufa
    where ufa.facebook_id = normalized_facebook_id
      and (account_id_input is null or ufa.id <> account_id_input)
  ) then
    raise exception 'Facebook ID này đã được liên kết với tài khoản khác.' using errcode = '23505';
  end if;

  if is_primary_input then
    update public.user_facebook_accounts
    set is_primary = false
    where user_id = auth.uid()
      and (account_id_input is null or id <> account_id_input);
  end if;

  if account_id_input is null then
    insert into public.user_facebook_accounts(
      user_id,
      facebook_id,
      facebook_url_original,
      facebook_url_normalized,
      facebook_id_status,
      resolved_at,
      resolved_by,
      is_primary,
      note,
      metadata
    )
    values(
      auth.uid(),
      normalized_facebook_id,
      normalized_url_original,
      coalesce(normalized_url, normalized_url_original),
      normalized_status,
      case when normalized_status in ('resolved', 'manual_verified') then now() else null end,
      case when normalized_status = 'manual_verified' then auth.uid() else null end,
      is_primary_input,
      nullif(trim(note_input), ''),
      coalesce(metadata_input, '{}'::jsonb)
    )
    returning * into account_record;
  else
    update public.user_facebook_accounts
    set
      facebook_id = normalized_facebook_id,
      facebook_url_original = normalized_url_original,
      facebook_url_normalized = coalesce(normalized_url, normalized_url_original),
      facebook_id_status = normalized_status,
      resolved_at = case when normalized_status in ('resolved', 'manual_verified') then coalesce(resolved_at, now()) else null end,
      resolved_by = case when normalized_status = 'manual_verified' then auth.uid() else resolved_by end,
      is_primary = is_primary_input,
      note = nullif(trim(note_input), ''),
      metadata = coalesce(metadata, '{}'::jsonb) || coalesce(metadata_input, '{}'::jsonb),
      updated_at = now()
    where id = account_id_input
      and user_id = auth.uid()
    returning * into account_record;
  end if;

  if not exists (
    select 1
    from public.user_facebook_accounts ufa
    where ufa.user_id = auth.uid()
      and ufa.is_primary = true
  ) then
    update public.user_facebook_accounts
    set is_primary = true
    where id = account_record.id
    returning * into account_record;
  end if;

  perform private.write_ttc_audit(
    'User',
    'upsert_facebook_account',
    'user_facebook_accounts',
    account_record.id::text,
    case when existing_record.id is null then null else to_jsonb(existing_record) end,
    jsonb_build_object(
      'id', account_record.id,
      'user_id', account_record.user_id,
      'facebook_id_status', account_record.facebook_id_status,
      'has_facebook_id', account_record.facebook_id is not null,
      'is_primary', account_record.is_primary
    ),
    'User cập nhật Facebook ID'
  );

  return jsonb_build_object('account', to_jsonb(account_record));
end;
$function$;

create or replace function public.list_available_ttc_tasks(
  facebook_account_id_input bigint default null,
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
  account_record public.user_facebook_accounts%rowtype;
  normalized_page integer := greatest(coalesce(page_number, 1), 1);
  normalized_size integer := least(greatest(coalesce(page_size, 25), 1), 100);
  rows_json jsonb;
  total_count bigint;
begin
  if auth.uid() is null then
    raise exception 'Bạn phải đăng nhập để xem nhiệm vụ.' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.user_profiles up
    where up.user_id = auth.uid()
      and up.status = 'active'
  ) then
    raise exception 'Hồ sơ user chưa sẵn sàng để xem nhiệm vụ TTC.' using errcode = '42501';
  end if;

  if facebook_account_id_input is not null then
    select *
    into account_record
    from public.user_facebook_accounts
    where id = facebook_account_id_input
      and user_id = auth.uid()
      and facebook_id is not null
      and facebook_id_status in ('resolved', 'manual_verified');
    if not found then
      raise exception 'Tài khoản Facebook chưa được xác minh.' using errcode = '42501';
    end if;
  else
    select *
    into account_record
    from public.user_facebook_accounts
    where user_id = auth.uid()
      and facebook_id is not null
      and facebook_id_status in ('resolved', 'manual_verified')
    order by is_primary desc, created_at desc
    limit 1;
    if not found then
      raise exception 'Bạn cần liên kết Facebook ID trước khi nhận nhiệm vụ.' using errcode = '42501';
    end if;
  end if;

  select count(*)
  into total_count
  from public.ttc_tasks t
  join public.ttc_campaigns c on c.id = t.campaign_id
  join public.ttc_interaction_types it on it.code = c.interaction_type_code
  where t.status = 'available'
    and c.status in ('queued', 'running')
    and c.owner_user_id <> auth.uid()
    and it.is_active = true
    and not exists (
      select 1
      from public.ttc_tasks prior
      where prior.campaign_id = c.id
        and prior.worker_facebook_id = account_record.facebook_id
        and prior.status in ('assigned', 'submitted', 'verifying', 'completed')
    );

  select coalesce(jsonb_agg(to_jsonb(row_item) order by row_item.created_at asc, row_item.task_id asc), '[]'::jsonb)
  into rows_json
  from (
    select
      t.id as task_id,
      t.campaign_id,
      t.sequence_no,
      c.interaction_type_code,
      it.label as interaction_label,
      c.target_url,
      c.target_label,
      c.target_quantity,
      c.completed_count,
      c.worker_reward,
      c.created_at
    from public.ttc_tasks t
    join public.ttc_campaigns c on c.id = t.campaign_id
    join public.ttc_interaction_types it on it.code = c.interaction_type_code
    where t.status = 'available'
      and c.status in ('queued', 'running')
      and c.owner_user_id <> auth.uid()
      and it.is_active = true
      and not exists (
        select 1
        from public.ttc_tasks prior
        where prior.campaign_id = c.id
          and prior.worker_facebook_id = account_record.facebook_id
          and prior.status in ('assigned', 'submitted', 'verifying', 'completed')
      )
    order by c.created_at asc, t.id asc
    limit normalized_size
    offset (normalized_page - 1) * normalized_size
  ) row_item;

  return jsonb_build_object(
    'rows', rows_json,
    'total', total_count,
    'page', normalized_page,
    'pageSize', normalized_size,
    'facebook_account_id', account_record.id
  );
end;
$function$;

create or replace function public.list_available_ttc_campaigns(
  facebook_account_id_input bigint default null,
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
  tasks_result jsonb;
begin
  tasks_result := public.list_available_ttc_tasks(
    facebook_account_id_input,
    page_number,
    page_size
  );

  return jsonb_build_object(
    'rows',
    (
      select coalesce(jsonb_agg(campaign_row), '[]'::jsonb)
      from (
        select distinct on ((task_item->>'campaign_id')::bigint)
          jsonb_build_object(
            'campaign_id', (task_item->>'campaign_id')::bigint,
            'interaction_type_code', task_item->>'interaction_type_code',
            'interaction_label', task_item->>'interaction_label',
            'target_url', task_item->>'target_url',
            'target_label', task_item->>'target_label',
            'target_quantity', (task_item->>'target_quantity')::integer,
            'completed_count', (task_item->>'completed_count')::integer,
            'worker_reward', (task_item->>'worker_reward')::numeric,
            'sample_task_id', (task_item->>'task_id')::bigint,
            'created_at', task_item->>'created_at'
          ) as campaign_row
        from jsonb_array_elements(coalesce(tasks_result->'rows', '[]'::jsonb)) task_item
        order by (task_item->>'campaign_id')::bigint, task_item->>'created_at'
      ) deduped
    ),
    'totalTasks', tasks_result->'total',
    'page', tasks_result->'page',
    'pageSize', tasks_result->'pageSize',
    'facebook_account_id', tasks_result->'facebook_account_id'
  );
end;
$function$;

create or replace function public.list_my_ttc_tasks(
  status_input text default null,
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
  normalized_status text := nullif(trim(status_input), '');
  rows_json jsonb;
  total_count bigint;
begin
  if auth.uid() is null then
    raise exception 'Bạn phải đăng nhập để xem nhiệm vụ của mình.' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.user_profiles up
    where up.user_id = auth.uid()
      and up.status <> 'locked'
  ) then
    raise exception 'Không tìm thấy hồ sơ user.' using errcode = '42501';
  end if;
  if normalized_status is not null
    and normalized_status not in ('assigned', 'submitted', 'verifying', 'completed', 'rejected', 'expired') then
    raise exception 'Trạng thái nhiệm vụ không hợp lệ.' using errcode = '22023';
  end if;

  select count(*)
  into total_count
  from public.ttc_tasks t
  where t.assignee_user_id = auth.uid()
    and (normalized_status is null or t.status = normalized_status);

  select coalesce(jsonb_agg(to_jsonb(row_item) order by row_item.updated_at desc, row_item.task_id desc), '[]'::jsonb)
  into rows_json
  from (
    select
      t.id as task_id,
      t.campaign_id,
      t.sequence_no,
      t.status,
      t.claimed_at,
      t.submitted_at,
      t.verified_at,
      t.expires_at,
      t.evidence,
      t.rejection_reason,
      t.updated_at,
      t.worker_facebook_account_id,
      t.worker_facebook_id,
      c.interaction_type_code,
      it.label as interaction_label,
      c.target_url,
      c.target_label,
      c.worker_reward,
      c.status as campaign_status
    from public.ttc_tasks t
    join public.ttc_campaigns c on c.id = t.campaign_id
    join public.ttc_interaction_types it on it.code = c.interaction_type_code
    where t.assignee_user_id = auth.uid()
      and (normalized_status is null or t.status = normalized_status)
    order by t.updated_at desc, t.id desc
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
  campaign_record public.ttc_campaigns%rowtype;
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

  select *
  into campaign_record
  from public.ttc_campaigns
  where id = task_record.campaign_id
  for update;

  if campaign_record.status not in ('queued', 'running') then
    raise exception 'Chiến dịch không còn nhận kết quả nhiệm vụ.' using errcode = '22023';
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
  before_campaign public.ttc_campaigns%rowtype;
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
  into before_campaign
  from public.ttc_campaigns
  where id = before_task.campaign_id
  for update;
  if not found then
    raise exception 'Không tìm thấy chiến dịch của nhiệm vụ.' using errcode = '22023';
  end if;
  if before_campaign.status not in ('queued', 'running') then
    raise exception 'Chiến dịch đã dừng/hủy nên không thể duyệt cộng xu nhiệm vụ.' using errcode = '23514';
  end if;
  if before_campaign.refunded_amount > 0 then
    raise exception 'Chiến dịch đã có hoàn xu nên không thể duyệt nhiệm vụ mới.' using errcode = '23514';
  end if;

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

  campaign_record := before_campaign;
  if next_status = 'completed' then
    update public.ttc_campaigns
    set
      completed_count = completed_count + 1,
      spent_amount = spent_amount + before_campaign.unit_cost,
      status = case
        when completed_count + 1 >= target_quantity then 'completed'
        else 'running'
      end
    where id = before_campaign.id
      and status in ('queued', 'running')
      and refunded_amount = 0
    returning * into campaign_record;

    if not found then
      raise exception 'Chiến dịch không còn đủ điều kiện cộng xu nhiệm vụ.' using errcode = '23514';
    end if;

    ledger_result := private.post_wallet_ledger(
      task_record.assignee_user_id,
      before_campaign.worker_reward,
      'earn_task',
      'ttc_tasks',
      task_record.id::text,
      'ttc_task:reward:' || task_record.id::text,
      'Thưởng nhiệm vụ TTC #' || task_record.id,
      coalesce(reason_input, 'Nhiệm vụ TTC đã xác minh thành công'),
      jsonb_build_object('task_id', task_record.id, 'campaign_id', before_campaign.id),
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
  affected_tasks integer := 0;
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

  with affected as (
    select id, status
    from public.ttc_tasks
    where campaign_id = before_campaign.id
      and status in ('available', 'assigned', 'submitted', 'verifying')
    for update
  ),
  updated as (
    update public.ttc_tasks t
    set
      status = case
        when affected.status in ('submitted', 'verifying') then 'rejected'
        else 'expired'
      end,
      verified_at = case
        when affected.status in ('submitted', 'verifying') then now()
        else t.verified_at
      end,
      verified_by = case
        when affected.status in ('submitted', 'verifying') and is_staff then actor.user_id
        else t.verified_by
      end,
      rejection_reason = case
        when affected.status in ('submitted', 'verifying') then trim(reason_input)
        else t.rejection_reason
      end,
      metadata = coalesce(t.metadata, '{}'::jsonb) || jsonb_build_object('cancelled_with_campaign', true)
    from affected
    where t.id = affected.id
    returning t.id, affected.status as before_status, t.status as after_status
  ),
  logged as (
    insert into public.ttc_task_check_logs(
      task_id,
      campaign_id,
      actor_id,
      check_type,
      result,
      before_status,
      after_status,
      reason,
      metadata
    )
    select
      updated.id,
      before_campaign.id,
      auth.uid(),
      'system',
      case when updated.after_status = 'rejected' then 'failed' else 'pending' end,
      updated.before_status,
      updated.after_status,
      trim(reason_input),
      jsonb_build_object('campaign_cancelled', true)
    from updated
    returning 1
  )
  select count(*) into affected_tasks from logged;

  refundable_amount := greatest(
    before_campaign.reserved_amount - before_campaign.spent_amount - before_campaign.refunded_amount,
    0
  );

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
    to_jsonb(campaign_record) || jsonb_build_object('affected_tasks', affected_tasks),
    reason_input
  );

  return jsonb_build_object(
    'campaign', to_jsonb(campaign_record),
    'wallet', ledger_result->'wallet',
    'refunded_amount', refundable_amount,
    'affected_tasks', affected_tasks,
    'already_processed', false
  );
end;
$function$;

revoke all on function public.ensure_my_user_profile(text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.ensure_my_user_profile(text, text, text, jsonb) to authenticated;
revoke all on function public.upsert_my_facebook_account(bigint, text, text, text, text, boolean, text, jsonb) from public, anon, authenticated;
grant execute on function public.upsert_my_facebook_account(bigint, text, text, text, text, boolean, text, jsonb) to authenticated;
revoke all on function public.list_available_ttc_tasks(bigint, integer, integer) from public, anon, authenticated;
grant execute on function public.list_available_ttc_tasks(bigint, integer, integer) to authenticated;
revoke all on function public.list_available_ttc_campaigns(bigint, integer, integer) from public, anon, authenticated;
grant execute on function public.list_available_ttc_campaigns(bigint, integer, integer) to authenticated;
revoke all on function public.list_my_ttc_tasks(text, integer, integer) from public, anon, authenticated;
grant execute on function public.list_my_ttc_tasks(text, integer, integer) to authenticated;

notify pgrst, 'reload schema';
