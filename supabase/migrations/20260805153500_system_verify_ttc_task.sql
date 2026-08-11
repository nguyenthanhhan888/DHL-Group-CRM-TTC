create or replace function public.system_verify_ttc_task(
  task_id_input bigint,
  metadata_input jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  task_record public.ttc_tasks%rowtype;
  before_task public.ttc_tasks%rowtype;
  campaign_record public.ttc_campaigns%rowtype;
  ledger_result jsonb := null;
begin
  if coalesce(metadata_input->>'verified', '') <> 'true' then
    raise exception 'Facebook API chưa xác nhận nhiệm vụ.' using errcode = '22023';
  end if;

  select *
  into before_task
  from public.ttc_tasks
  where id = task_id_input
  for update;
  if not found then
    raise exception 'Không tìm thấy nhiệm vụ TTC.' using errcode = '22023';
  end if;
  if before_task.status = 'completed' then
    return jsonb_build_object('task', to_jsonb(before_task), 'already_processed', true, 'credited', true);
  end if;
  if before_task.status not in ('submitted', 'verifying') then
    raise exception 'Nhiệm vụ chưa ở trạng thái có thể auto xác minh.' using errcode = '22023';
  end if;

  select *
  into campaign_record
  from public.ttc_campaigns
  where id = before_task.campaign_id
  for update;
  if not found then
    raise exception 'Không tìm thấy chiến dịch TTC.' using errcode = '22023';
  end if;

  update public.ttc_tasks
  set
    status = 'completed',
    verified_at = now(),
    verified_by = null,
    verification_result = coalesce(metadata_input, '{}'::jsonb),
    rejection_reason = null
  where id = before_task.id
  returning * into task_record;

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
    coalesce(metadata_input->>'reason', 'Facebook API đã xác minh nhiệm vụ thành công'),
    jsonb_build_object(
      'task_id', task_record.id,
      'campaign_id', campaign_record.id,
      'verification', coalesce(metadata_input, '{}'::jsonb)
    ),
    null,
    'system'
  );

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
  values(
    task_record.id,
    task_record.campaign_id,
    null,
    'auto',
    'success',
    before_task.status,
    task_record.status,
    coalesce(metadata_input->>'reason', 'Facebook API xác minh thành công'),
    coalesce(metadata_input, '{}'::jsonb)
  );

  perform private.write_ttc_audit(
    'TTC',
    'system_verify_task_approve',
    'ttc_tasks',
    task_record.id::text,
    to_jsonb(before_task),
    to_jsonb(task_record),
    coalesce(metadata_input->>'reason', 'Facebook API xác minh thành công')
  );

  return jsonb_build_object(
    'task', to_jsonb(task_record),
    'campaign', to_jsonb(campaign_record),
    'wallet', ledger_result->'wallet',
    'credited', true,
    'already_processed', false
  );
end;
$function$;

revoke all on function public.system_verify_ttc_task(bigint, jsonb) from public, anon, authenticated;
grant execute on function public.system_verify_ttc_task(bigint, jsonb) to service_role;
