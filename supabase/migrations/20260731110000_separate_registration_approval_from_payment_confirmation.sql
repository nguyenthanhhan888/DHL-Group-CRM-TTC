-- Registration approval should only approve the profile/request and keep the
-- related payment pending. Money confirmation stays in Payments/PayOS.
create or replace function public.approve_registration_request(request_id_input bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor public.user_roles%rowtype;
  request_record public.registration_requests%rowtype;
  before_record public.registration_requests%rowtype;
  payment_id_value bigint;
  payment_record public.payments%rowtype;
begin
  actor := private.assert_payment_permission();
  if lower(actor.role) <> 'admin'
    and not public.has_active_permission('registration-requests') then
    raise exception 'Không có quyền duyệt đơn đăng ký.' using errcode = '42501';
  end if;

  select *
  into request_record
  from public.registration_requests
  where id = request_id_input
  for update;

  if not found then
    raise exception 'Không tìm thấy đơn đăng ký.';
  end if;
  if lower(request_record.status) <> 'pending' then
    raise exception 'Chỉ đơn Pending mới được duyệt.';
  end if;

  before_record := request_record;
  payment_id_value := private.registration_request_payment(request_record);

  select *
  into payment_record
  from public.payments
  where id = payment_id_value
  for update;

  if not found then
    raise exception 'Không tìm thấy thanh toán của đơn đăng ký.';
  end if;
  if lower(coalesce(payment_record.payment_status, '')) <> 'pending' then
    raise exception 'Chỉ duyệt hồ sơ khi thanh toán đang Pending.' using errcode = '22023';
  end if;

  update public.registration_requests
  set
    payment_id = payment_id_value,
    status = 'approved',
    reviewed_at = pg_catalog.now(),
    reviewed_by = actor.user_id,
    rejection_reason = null
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
    'approve_profile_pending_payment',
    to_jsonb(before_record),
    to_jsonb(request_record),
    'Duyệt hồ sơ đăng ký, giữ thanh toán Pending để khách chuyển khoản/PayOS'
  );

  return jsonb_build_object(
    'request', to_jsonb(request_record),
    'payment', to_jsonb(payment_record)
  );
end;
$function$;

revoke all on function public.approve_registration_request(bigint)
  from public, anon, authenticated;
grant execute on function public.approve_registration_request(bigint)
  to authenticated;
