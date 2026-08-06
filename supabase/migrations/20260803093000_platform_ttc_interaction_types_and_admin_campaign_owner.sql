alter table public.ttc_interaction_types
drop constraint if exists ttc_interaction_types_code_check;

alter table public.ttc_interaction_types
add constraint ttc_interaction_types_code_check
check (code ~ '^[a-z][a-z0-9_]{1,63}$');

update public.ttc_interaction_types
set config = coalesce(config, '{}'::jsonb)
  || jsonb_build_object(
    'platform', 'facebook',
    'action', code,
    'legacy_code', true
  )
where coalesce(config->>'platform', '') = '';

insert into public.ttc_interaction_types(
  code,
  label,
  unit_cost,
  worker_reward,
  min_quantity,
  max_quantity,
  hold_seconds,
  is_active,
  config
)
values
  ('facebook_like', 'Facebook - Tăng like', 200, 100, 10, 1000, 0, true, '{"platform":"facebook","action":"like"}'::jsonb),
  ('facebook_follow', 'Facebook - Tăng follow', 200, 100, 10, 1000, 0, true, '{"platform":"facebook","action":"follow"}'::jsonb),
  ('facebook_comment', 'Facebook - Tăng comment', 300, 150, 5, 500, 0, true, '{"platform":"facebook","action":"comment"}'::jsonb),
  ('facebook_reaction', 'Facebook - Tăng cảm xúc', 200, 100, 10, 1000, 0, true, '{"platform":"facebook","action":"reaction"}'::jsonb),
  ('facebook_share', 'Facebook - Tăng share', 300, 150, 5, 500, 0, true, '{"platform":"facebook","action":"share"}'::jsonb),
  ('facebook_join_group', 'Facebook - Tham gia nhóm', 300, 150, 5, 500, 0, true, '{"platform":"facebook","action":"join_group"}'::jsonb),
  ('tiktok_like', 'TikTok - Tăng like', 200, 100, 10, 1000, 0, true, '{"platform":"tiktok","action":"like"}'::jsonb),
  ('tiktok_follow', 'TikTok - Tăng follow', 500, 250, 10, 1000, 0, true, '{"platform":"tiktok","action":"follow"}'::jsonb),
  ('tiktok_comment', 'TikTok - Tăng comment', 300, 150, 5, 500, 0, true, '{"platform":"tiktok","action":"comment"}'::jsonb),
  ('instagram_like', 'Instagram - Tăng like', 200, 100, 10, 1000, 0, true, '{"platform":"instagram","action":"like"}'::jsonb),
  ('instagram_follow', 'Instagram - Tăng follow', 500, 250, 10, 1000, 0, true, '{"platform":"instagram","action":"follow"}'::jsonb),
  ('instagram_comment', 'Instagram - Tăng comment', 300, 150, 5, 500, 0, true, '{"platform":"instagram","action":"comment"}'::jsonb),
  ('youtube_like', 'YouTube - Tăng like', 200, 100, 10, 1000, 0, true, '{"platform":"youtube","action":"like"}'::jsonb),
  ('youtube_subscribe', 'YouTube - Tăng subscribe', 500, 250, 10, 1000, 0, true, '{"platform":"youtube","action":"subscribe"}'::jsonb),
  ('youtube_comment', 'YouTube - Tăng comment', 300, 150, 5, 500, 0, true, '{"platform":"youtube","action":"comment"}'::jsonb)
on conflict (code) do update
set
  label = excluded.label,
  config = excluded.config,
  is_active = true,
  updated_at = now();

update public.ttc_interaction_types
set is_active = false,
    updated_at = now()
where code in ('like', 'reaction', 'comment', 'share', 'follow', 'join_group');

grant update(label, unit_cost, worker_reward, min_quantity, max_quantity, hold_seconds, is_active, config)
on table public.ttc_interaction_types
to authenticated;

create or replace function public.admin_create_ttc_campaign_for_user(
  owner_user_id_input uuid,
  interaction_type_input text,
  target_url_input text,
  target_quantity_input integer,
  idempotency_key_input text,
  target_facebook_id_input text default null,
  target_label_input text default null,
  comment_options_input jsonb default '[]'::jsonb,
  metadata_input jsonb default '{}'::jsonb,
  admin_reason_input text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor public.user_roles%rowtype;
  profile_record public.user_profiles%rowtype;
  type_record public.ttc_interaction_types%rowtype;
  campaign_record public.ttc_campaigns%rowtype;
  ledger_result jsonb;
  task_index integer;
  normalized_key text := nullif(trim(idempotency_key_input), '');
  total_cost numeric(14, 2);
begin
  actor := private.assert_ttc_staff('admin-ttc');

  if owner_user_id_input is null then
    raise exception 'User owner là bắt buộc.' using errcode = '22023';
  end if;
  if normalized_key is null then
    raise exception 'idempotency_key là bắt buộc.' using errcode = '22023';
  end if;

  select *
  into campaign_record
  from public.ttc_campaigns
  where owner_user_id = owner_user_id_input
    and idempotency_key = normalized_key;
  if found then
    return jsonb_build_object('campaign', to_jsonb(campaign_record), 'already_processed', true);
  end if;

  select *
  into profile_record
  from public.user_profiles
  where user_id = owner_user_id_input
    and status = 'active';
  if not found then
    raise exception 'User owner chưa có hồ sơ active để tạo tăng tương tác.' using errcode = '42501';
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
    created_by_admin,
    admin_reason,
    idempotency_key,
    metadata
  )
  values(
    owner_user_id_input,
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
    actor.user_id,
    nullif(trim(admin_reason_input), ''),
    normalized_key,
    coalesce(metadata_input, '{}'::jsonb)
      || jsonb_build_object(
        'created_by_admin', actor.user_id,
        'platform', type_record.config->>'platform',
        'action', type_record.config->>'action'
      )
  )
  returning * into campaign_record;

  ledger_result := private.post_wallet_ledger(
    owner_user_id_input,
    -total_cost,
    'spend_campaign',
    'ttc_campaigns',
    campaign_record.id::text,
    'admin_ttc_campaign:create:' || normalized_key,
    'Admin tạo tăng tương tác TTC #' || campaign_record.id,
    coalesce(nullif(trim(admin_reason_input), ''), 'Admin tạo tăng tương tác TTC'),
    jsonb_build_object(
      'campaign_id', campaign_record.id,
      'interaction_type', type_record.code,
      'platform', type_record.config->>'platform',
      'action', type_record.config->>'action'
    ),
    actor.user_id,
    'staff'
  );

  for task_index in 1..target_quantity_input loop
    insert into public.ttc_tasks(campaign_id, sequence_no)
    values (campaign_record.id, task_index);
  end loop;

  perform private.write_ttc_audit(
    'TTC',
    'admin_create_campaign',
    'ttc_campaigns',
    campaign_record.id::text,
    null,
    to_jsonb(campaign_record),
    coalesce(nullif(trim(admin_reason_input), ''), 'Admin tạo tăng tương tác TTC')
  );

  return jsonb_build_object(
    'campaign', to_jsonb(campaign_record),
    'wallet', ledger_result->'wallet',
    'task_count', target_quantity_input,
    'already_processed', false
  );
end;
$function$;

revoke all on function public.admin_create_ttc_campaign_for_user(uuid, text, text, integer, text, text, text, jsonb, jsonb, text)
from public, anon, authenticated;
grant execute on function public.admin_create_ttc_campaign_for_user(uuid, text, text, integer, text, text, text, jsonb, jsonb, text)
to authenticated;
