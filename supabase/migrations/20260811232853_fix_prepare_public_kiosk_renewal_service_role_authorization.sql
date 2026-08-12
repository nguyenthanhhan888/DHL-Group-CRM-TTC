-- Replace the legacy request-role check while preserving the secure public
-- renewal preparation contract and all server-authoritative payment behavior.

create or replace function public.prepare_public_kiosk_renewal(
  kiosk_id_input bigint,
  months_input integer,
  nonce_hash_input text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  kiosk_record public.kiosks%rowtype;
  package_record public.business_types%rowtype;
  payment_record public.payments%rowtype;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'Chỉ API server được chuẩn bị gia hạn công khai.' using errcode = '42501';
  end if;

  if months_input not in (1, 3, 6, 12) then
    raise exception 'Thời hạn gia hạn không được hỗ trợ.' using errcode = '22023';
  end if;

  update private.public_renewal_authorizations
  set consumed_at = now()
  where nonce_hash = nonce_hash_input
    and kiosk_id = kiosk_id_input
    and consumed_at is null
    and expires_at > now();

  if not found then
    raise exception 'Quyền gia hạn đã hết hạn hoặc đã được sử dụng.' using errcode = '42501';
  end if;

  select *
  into kiosk_record
  from public.kiosks
  where id = kiosk_id_input
  for update;

  if not found or kiosk_record.customer_id is null then
    raise exception 'Không tìm thấy Kiosk hợp lệ.' using errcode = 'P0002';
  end if;

  select *
  into package_record
  from public.business_types
  where id = kiosk_record.business_type_id
    and is_active = true;

  if not found
    or package_record.price_per_month is null
    or package_record.price_per_month <= 0 then
    raise exception 'Giá dịch vụ hiện tại không hợp lệ.' using errcode = '22023';
  end if;

  insert into public.payments(
    customer_id,
    kiosk_id,
    months,
    price_per_month,
    discount,
    total_amount,
    payment_method,
    payment_status,
    note,
    transaction_type,
    service_month_delta
  ) values (
    kiosk_record.customer_id,
    kiosk_record.id,
    months_input,
    package_record.price_per_month,
    0,
    package_record.price_per_month * months_input,
    'transfer',
    'pending',
    'Public PayOS Kiosk renewal',
    'standard',
    0
  )
  returning * into payment_record;

  return jsonb_build_object(
    'payment', to_jsonb(payment_record),
    'kiosk_name', kiosk_record.facebook_name,
    'business_type', package_record.name
  );
end;
$function$;

revoke all on function public.prepare_public_kiosk_renewal(bigint, integer, text)
  from public, anon, authenticated;
grant execute on function public.prepare_public_kiosk_renewal(bigint, integer, text)
  to service_role;
