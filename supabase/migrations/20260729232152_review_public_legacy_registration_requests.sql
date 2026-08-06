create or replace function public.review_public_legacy_registration_request(
  request_id_input bigint,
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
  request_record public.registration_requests%rowtype;
  next_status text;
begin
  if auth.uid() is null then
    raise exception 'Bạn phải đăng nhập để xử lý yêu cầu.' using errcode = '42501';
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
          and 'registration-requests' = any(rp.permissions)
      )
    );
  if not found then
    raise exception 'Không có quyền xử lý yêu cầu bổ sung.' using errcode = '42501';
  end if;

  select *
  into request_record
  from public.registration_requests r
  where r.id = request_id_input
  for update;
  if not found then
    raise exception 'Không tìm thấy yêu cầu bổ sung.';
  end if;
  if request_record.metadata->>'request_type' <> 'legacy' then
    raise exception 'Yêu cầu này không thuộc luồng bổ sung khách hàng cũ.' using errcode = '22023';
  end if;
  if request_record.status <> 'pending' then
    raise exception 'Chỉ yêu cầu đang chờ mới có thể được xử lý.';
  end if;

  if lower(trim(action_input)) = 'approve' then
    next_status := 'approved';
  elsif lower(trim(action_input)) = 'cancel' then
    if nullif(trim(reason_input), '') is null then
      raise exception 'Lý do hủy là bắt buộc.' using errcode = '22023';
    end if;
    next_status := 'rejected';
  else
    raise exception 'Thao tác xử lý không hợp lệ.' using errcode = '22023';
  end if;

  update public.registration_requests
  set
    status = next_status,
    reviewed_at = pg_catalog.now(),
    reviewed_by = actor.user_id,
    rejection_reason = case
      when next_status = 'rejected' then trim(reason_input)
      else null
    end,
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'legacy_review_action', lower(trim(action_input)),
      'legacy_reviewed_by', actor.user_id,
      'legacy_reviewed_at', pg_catalog.now()
    )
  where id = request_record.id
  returning * into request_record;

  insert into public.audit_logs(
    actor_id, actor_name, actor_type, actor_role, module, entity,
    record_id, action, before, after, reason
  )
  values(
    actor.user_id,
    coalesce(actor.display_name, actor.username, 'System'),
    'staff',
    actor.role,
    'Registration',
    'registration_requests',
    request_record.id::text,
    'review_legacy_' || lower(trim(action_input)),
    jsonb_build_object('status', 'pending'),
    jsonb_build_object('status', request_record.status),
    nullif(trim(reason_input), '')
  );

  return jsonb_build_object('request', to_jsonb(request_record));
end;
$function$;

revoke all on function public.review_public_legacy_registration_request(bigint, text, text)
  from public, anon, authenticated;
grant execute on function public.review_public_legacy_registration_request(bigint, text, text)
  to authenticated;
