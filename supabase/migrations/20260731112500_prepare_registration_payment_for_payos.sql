-- Materialize a public registration request into pending customer/kiosk/payment
-- records so the server-side PayOS endpoint can show QR immediately after signup.
-- This RPC is intentionally service_role-only; the public frontend must go
-- through /api/payos/create-registration-payment for validation and rate limits.
create or replace function public.prepare_registration_payment_for_payos(
  request_id_input bigint,
  phone_input text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  request_record public.registration_requests%rowtype;
  customer_record public.customers%rowtype;
  kiosk_record public.kiosks%rowtype;
  payment_record public.payments%rowtype;
  business_type_record public.business_types%rowtype;
  normalized_phone_input text;
  normalized_request_phone text;
  group_member_base_url text;
begin
  normalized_phone_input := regexp_replace(coalesce(phone_input, ''), '[^0-9+]', '', 'g');
  if normalized_phone_input = '' then
    raise exception 'Số điện thoại xác nhận không hợp lệ.' using errcode = '22023';
  end if;

  select *
  into request_record
  from public.registration_requests
  where id = request_id_input
  for update;

  if not found then
    raise exception 'Không tìm thấy yêu cầu đăng ký.';
  end if;

  normalized_request_phone := regexp_replace(coalesce(request_record.phone, ''), '[^0-9+]', '', 'g');
  if normalized_request_phone <> normalized_phone_input then
    raise exception 'Số điện thoại không khớp yêu cầu đăng ký.' using errcode = '42501';
  end if;

  if lower(coalesce(request_record.status, 'pending')) not in ('pending', 'approved') then
    raise exception 'Yêu cầu đăng ký không còn ở trạng thái có thể thanh toán.' using errcode = '22023';
  end if;

  if request_record.payment_id is not null then
    select *
    into payment_record
    from public.payments
    where id = request_record.payment_id
    for update;

    if not found then
      raise exception 'Không tìm thấy thanh toán của yêu cầu đăng ký.';
    end if;

    return jsonb_build_object(
      'request', to_jsonb(request_record),
      'payment', to_jsonb(payment_record)
    );
  end if;

  if request_record.customer_id is not null then
    select *
    into customer_record
    from public.customers
    where id = request_record.customer_id
    for update;
  end if;

  if customer_record.id is null and nullif(request_record.facebook_id, '') is not null then
    select *
    into customer_record
    from public.customers c
    where c.facebook_id = request_record.facebook_id
    order by c.id
    limit 1
    for update;
  end if;

  if customer_record.id is null then
    insert into public.customers(
      facebook_name, facebook_id, facebook_link, phone, address,
      status, total_kiosks, total_paid, note
    )
    values(
      request_record.facebook_name,
      nullif(request_record.facebook_id, ''),
      request_record.facebook_link,
      request_record.phone,
      request_record.address,
      'pending',
      0,
      0,
      request_record.note
    )
    returning * into customer_record;
  end if;

  select *
  into business_type_record
  from public.business_types
  where id = request_record.business_type_id
    and is_active = true;
  if not found then
    raise exception 'Loại hình kinh doanh không tồn tại hoặc đã ngừng hoạt động.' using errcode = '22023';
  end if;

  select case
    when nullif(trim(s.value), '') ~ '^[0-9]+$'
      then 'https://www.facebook.com/groups/' || trim(s.value) || '/user/'
    else null
  end
  into group_member_base_url
  from public.settings s
  where s.key = 'facebook_group_id';

  if request_record.kiosk_id is not null then
    select *
    into kiosk_record
    from public.kiosks
    where id = request_record.kiosk_id
    for update;
  end if;

  if kiosk_record.id is null and nullif(request_record.facebook_id, '') is not null then
    select *
    into kiosk_record
    from public.kiosks k
    where k.facebook_id = request_record.facebook_id
    order by k.id
    limit 1
    for update;
  end if;

  if kiosk_record.id is null then
    insert into public.kiosks(
      customer_id, facebook_name, facebook_id, facebook_link,
      facebook_group_link, category_id, business_type_id, service_name,
      start_date, end_date, status, auto_approve,
      total_paid, kiosk_total_paid, last_payment_date, note, is_primary
    )
    values(
      customer_record.id,
      request_record.facebook_name,
      nullif(request_record.facebook_id, ''),
      request_record.facebook_link,
      case
        when group_member_base_url is null or nullif(request_record.facebook_id, '') is null then null
        else group_member_base_url || request_record.facebook_id || '/'
      end,
      business_type_record.category_id,
      business_type_record.id,
      business_type_record.name,
      null,
      null,
      'pending',
      false,
      0,
      0,
      null,
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

  insert into public.payments(
    customer_id, kiosk_id, start_date, end_date, months,
    price_per_month, discount, discount_reason, total_amount,
    payment_method, payment_status, transaction_type, note
  )
  values(
    customer_record.id,
    kiosk_record.id,
    null,
    null,
    request_record.months,
    coalesce(request_record.price_per_month, business_type_record.price_per_month),
    coalesce(request_record.discount, 0),
    request_record.discount_reason,
    request_record.total_amount,
    coalesce(nullif(request_record.payment_method, ''), 'transfer'),
    'pending',
    'standard',
    request_record.note
  )
  returning * into payment_record;

  update public.registration_requests
  set
    customer_id = customer_record.id,
    kiosk_id = kiosk_record.id,
    payment_id = payment_record.id,
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'materialized_for_payos_at', pg_catalog.now()
    )
  where id = request_record.id
  returning * into request_record;

  update public.customers c
  set total_kiosks = (
    select count(*)::integer
    from public.kiosks k
    where k.customer_id = c.id
  )
  where c.id = customer_record.id
  returning * into customer_record;

  return jsonb_build_object(
    'request', to_jsonb(request_record),
    'customer', to_jsonb(customer_record),
    'kiosk', to_jsonb(kiosk_record),
    'payment', to_jsonb(payment_record)
  );
end;
$function$;

revoke all on function public.prepare_registration_payment_for_payos(bigint, text)
  from public, anon, authenticated;
grant execute on function public.prepare_registration_payment_for_payos(bigint, text)
  to service_role;
