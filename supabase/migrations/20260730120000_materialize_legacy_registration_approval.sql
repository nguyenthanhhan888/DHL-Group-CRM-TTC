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
  customer_record public.customers%rowtype;
  kiosk_record public.kiosks%rowtype;
  customer_payload jsonb;
  request_code_value text;
  customer_facebook_id_value text;
  customer_phone_value text;
  customer_name_value text;
  customer_link_value text;
  next_status text;
  amount_value numeric;
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

  if lower(trim(action_input)) = 'approve' then
    next_status := 'approved';
    if request_record.status = 'approved'
      and request_record.customer_id is not null
      and request_record.kiosk_id is not null then
      return jsonb_build_object(
        'request', to_jsonb(request_record),
        'customer_id', request_record.customer_id,
        'kiosk_id', request_record.kiosk_id,
        'already_processed', true
      );
    end if;
    if request_record.status not in ('pending', 'approved') then
      raise exception 'Yêu cầu đã bị từ chối và không thể duyệt.';
    end if;
  elsif lower(trim(action_input)) = 'cancel' then
    if request_record.status <> 'pending' then
      raise exception 'Chỉ yêu cầu đang chờ mới có thể được hủy.';
    end if;
    if nullif(trim(reason_input), '') is null then
      raise exception 'Lý do hủy là bắt buộc.' using errcode = '22023';
    end if;
    next_status := 'rejected';
  else
    raise exception 'Thao tác xử lý không hợp lệ.' using errcode = '22023';
  end if;

  if next_status = 'approved' then
    customer_payload := coalesce(request_record.metadata->'customer', '{}'::jsonb);
    request_code_value := nullif(request_record.metadata->>'request_code', '');
    customer_facebook_id_value := nullif(
      regexp_replace(coalesce(customer_payload->>'facebook_id', ''), '[^0-9]', '', 'g'),
      ''
    );
    customer_phone_value := nullif(trim(coalesce(customer_payload->>'phone', request_record.phone)), '');
    customer_name_value := nullif(trim(coalesce(customer_payload->>'facebook_name', request_record.facebook_name)), '');
    customer_link_value := nullif(trim(customer_payload->>'facebook_link'), '');
    amount_value := greatest(coalesce(request_record.total_amount, 0), 0);

    if customer_name_value is null or customer_phone_value is null then
      raise exception 'Hồ sơ thiếu tên hoặc số điện thoại khách hàng.' using errcode = '22023';
    end if;
    if request_record.category_id is null
      or request_record.business_type_id is null
      or request_record.requested_start_date is null
      or request_record.requested_end_date is null then
      raise exception 'Hồ sơ thiếu dữ liệu bắt buộc để tạo kiosk.' using errcode = '22023';
    end if;

    -- Serialize all kiosk approvals belonging to the same public submission.
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('legacy-approval:' || coalesce(request_code_value, request_record.id::text), 0)
    );

    if request_record.customer_id is not null then
      select * into customer_record
      from public.customers c
      where c.id = request_record.customer_id
      for update;
    end if;

    if customer_record.id is null and request_code_value is not null then
      select c.*
      into customer_record
      from public.registration_requests sibling
      join public.customers c on c.id = sibling.customer_id
      where sibling.metadata->>'request_type' = 'legacy'
        and sibling.metadata->>'request_code' = request_code_value
      order by sibling.id
      limit 1
      for update of c;
    end if;

    if customer_record.id is null then
      select *
      into customer_record
      from public.customers c
      where (customer_facebook_id_value is not null and c.facebook_id = customer_facebook_id_value)
         or c.phone = customer_phone_value
      order by
        case when customer_facebook_id_value is not null
          and c.facebook_id = customer_facebook_id_value then 0 else 1 end,
        c.id
      limit 1
      for update;
    end if;

    if customer_record.id is null then
      insert into public.customers(
        facebook_name, facebook_id, facebook_link, phone, status,
        total_paid, last_payment_date, note
      )
      values(
        customer_name_value,
        customer_facebook_id_value,
        customer_link_value,
        customer_phone_value,
        'active',
        amount_value,
        request_record.requested_start_date,
        'Bổ sung từ hồ sơ khách hàng cũ #' || request_record.id
      )
      returning * into customer_record;
    else
      update public.customers
      set
        facebook_name = coalesce(nullif(trim(facebook_name), ''), customer_name_value),
        facebook_id = coalesce(facebook_id, customer_facebook_id_value),
        facebook_link = coalesce(facebook_link, customer_link_value),
        phone = coalesce(phone, customer_phone_value),
        status = case when status = 'inactive' then status else 'active' end,
        total_paid = coalesce(total_paid, 0) + amount_value,
        last_payment_date = greatest(last_payment_date, request_record.requested_start_date),
        updated_at = pg_catalog.now()
      where id = customer_record.id
      returning * into customer_record;
    end if;

    if request_record.kiosk_id is not null then
      select * into kiosk_record
      from public.kiosks k
      where k.id = request_record.kiosk_id
      for update;
    end if;

    if kiosk_record.id is null and request_record.facebook_id is not null then
      select * into kiosk_record
      from public.kiosks k
      where k.facebook_id = request_record.facebook_id
      for update;
    end if;

    if kiosk_record.id is null then
      insert into public.kiosks(
        customer_id, facebook_name, facebook_id, facebook_link,
        category_id, business_type_id, service_name,
        start_date, end_date, status, auto_approve,
        total_paid, kiosk_total_paid, last_payment_date, note, is_primary
      )
      values(
        customer_record.id,
        request_record.facebook_name,
        request_record.facebook_id,
        request_record.facebook_link,
        request_record.category_id,
        request_record.business_type_id,
        request_record.service_name,
        request_record.requested_start_date,
        request_record.requested_end_date,
        case
          when request_record.requested_end_date < current_date then 'expired'
          else 'active'
        end,
        false,
        amount_value,
        amount_value,
        request_record.requested_start_date,
        request_record.note,
        not exists (
          select 1 from public.kiosks existing
          where existing.customer_id = customer_record.id and existing.is_primary
        )
      )
      returning * into kiosk_record;
    elsif kiosk_record.customer_id <> customer_record.id then
      raise exception 'Facebook ID kiosk đã thuộc về một khách hàng khác.' using errcode = '23505';
    end if;

    update public.registration_requests
    set
      status = 'approved',
      reviewed_at = pg_catalog.now(),
      reviewed_by = actor.user_id,
      rejection_reason = null,
      customer_id = customer_record.id,
      kiosk_id = kiosk_record.id,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'legacy_review_action', 'approve',
        'legacy_reviewed_by', actor.user_id,
        'legacy_reviewed_at', pg_catalog.now(),
        'materialized_at', pg_catalog.now()
      )
    where id = request_record.id
    returning * into request_record;
  else
    update public.registration_requests
    set
      status = next_status,
      reviewed_at = pg_catalog.now(),
      reviewed_by = actor.user_id,
      rejection_reason = trim(reason_input),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'legacy_review_action', 'cancel',
        'legacy_reviewed_by', actor.user_id,
        'legacy_reviewed_at', pg_catalog.now()
      )
    where id = request_record.id
    returning * into request_record;
  end if;

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
    jsonb_build_object('status', case when next_status = 'approved' then 'pending_or_incomplete' else 'pending' end),
    jsonb_build_object(
      'status', request_record.status,
      'customer_id', request_record.customer_id,
      'kiosk_id', request_record.kiosk_id
    ),
    nullif(trim(reason_input), '')
  );

  return jsonb_build_object(
    'request', to_jsonb(request_record),
    'customer_id', request_record.customer_id,
    'kiosk_id', request_record.kiosk_id,
    'already_processed', false
  );
end;
$function$;

revoke all on function public.review_public_legacy_registration_request(bigint, text, text)
  from public, anon, authenticated;
grant execute on function public.review_public_legacy_registration_request(bigint, text, text)
  to authenticated;
