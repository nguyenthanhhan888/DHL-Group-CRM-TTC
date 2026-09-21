-- Emergency stabilization: restore the proven pre-promotion public registration
-- payment materialization path under one unique, service-role-only RPC name.
-- Promotion schema and historical financial records remain untouched.

create function public.prepare_registration_payment_v2(
  request_ids_input bigint[],
  phone_input text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  normalized_phone text := pg_catalog.regexp_replace(coalesce(phone_input, ''), '[^0-9+]', '', 'g');
  request_count integer;
  request_record public.registration_requests%rowtype;
  batch_record public.registration_batches%rowtype;
  customer_record public.customers%rowtype;
  kiosk_record public.kiosks%rowtype;
  package_record public.business_types%rowtype;
  payment_record public.payments%rowtype;
  first_kiosk_id bigint;
  authoritative_total numeric := 0;
  item_total numeric;
  group_member_base_url text;
  result_items jsonb := '[]'::jsonb;
  batch_key text;
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then
    raise exception 'Chỉ API server được chuẩn bị thanh toán đăng ký.' using errcode = '42501';
  end if;

  request_count := coalesce(pg_catalog.array_length(request_ids_input, 1), 0);
  if request_count < 1 or request_count > 20 then
    raise exception 'Lô đăng ký phải có từ 1 đến 20 Kiosk.' using errcode = '22023';
  end if;
  if normalized_phone = '' then
    raise exception 'Số điện thoại xác nhận không hợp lệ.' using errcode = '22023';
  end if;
  if (select pg_catalog.count(distinct value) from pg_catalog.unnest(request_ids_input) value) <> request_count then
    raise exception 'Danh sách yêu cầu đăng ký bị trùng.' using errcode = '22023';
  end if;

  batch_key := 'registration-batch:' || (
    select pg_catalog.string_agg(value::text, ',' order by value)
    from pg_catalog.unnest(request_ids_input) value
  );
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(batch_key, 0));

  perform 1
  from public.registration_requests
  where id = any(request_ids_input)
  order by id
  for update;

  select pg_catalog.count(*)
  into request_count
  from public.registration_requests
  where id = any(request_ids_input);

  if request_count <> pg_catalog.array_length(request_ids_input, 1) then
    raise exception 'Không tìm thấy đầy đủ yêu cầu đăng ký.' using errcode = 'P0002';
  end if;
  if exists (
    select 1
    from public.registration_requests
    where id = any(request_ids_input)
      and pg_catalog.regexp_replace(coalesce(phone, ''), '[^0-9+]', '', 'g') <> normalized_phone
  ) then
    raise exception 'Số điện thoại không khớp lô đăng ký.' using errcode = '42501';
  end if;
  if exists (
    select 1
    from public.registration_requests
    where id = any(request_ids_input)
      and pg_catalog.lower(coalesce(status, 'pending')) not in ('awaiting_payment', 'pending', 'approved')
  ) then
    raise exception 'Lô đăng ký không còn có thể thanh toán.' using errcode = '22023';
  end if;

  select b.*
  into batch_record
  from public.registration_batches b
  join public.registration_requests r on r.registration_batch_id = b.id
  where r.id = any(request_ids_input)
  order by b.id
  limit 1
  for update of b;

  if found then
    if exists (
      select 1
      from public.registration_requests
      where id = any(request_ids_input)
        and registration_batch_id is distinct from batch_record.id
    ) then
      raise exception 'Yêu cầu đã thuộc lô đăng ký khác.' using errcode = '23505';
    end if;
    select * into payment_record from public.payments where id = batch_record.payment_id for update;
    return pg_catalog.jsonb_build_object(
      'batch', pg_catalog.to_jsonb(batch_record),
      'payment', pg_catalog.to_jsonb(payment_record),
      'items', (
        select coalesce(
          pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'requestId', i.registration_request_id,
            'kioskId', i.kiosk_id,
            'name', k.facebook_name,
            'months', i.months,
            'pricePerMonth', i.price_per_month,
            'discount', i.discount,
            'totalAmount', i.total_amount
          ) order by i.id),
          '[]'::jsonb
        )
        from public.registration_batch_items i
        join public.kiosks k on k.id = i.kiosk_id
        where i.batch_id = batch_record.id
      ),
      'reused', true
    );
  end if;

  select *
  into customer_record
  from public.customers
  where pg_catalog.regexp_replace(coalesce(phone, ''), '[^0-9+]', '', 'g') = normalized_phone
  order by id
  limit 1
  for update;

  if not found then
    select *
    into request_record
    from public.registration_requests
    where id = any(request_ids_input)
    order by id
    limit 1;
    insert into public.customers(
      facebook_name, facebook_id, facebook_link, phone, address,
      status, total_kiosks, total_paid, note
    ) values (
      request_record.facebook_name,
      nullif(request_record.facebook_id, ''),
      request_record.facebook_link,
      request_record.phone,
      request_record.address,
      'pending', 0, 0, request_record.note
    ) returning * into customer_record;
  end if;

  insert into public.registration_batches(customer_id, phone, status, total_amount)
  values (customer_record.id, normalized_phone, 'pending', 0)
  returning * into batch_record;

  select case
    when nullif(pg_catalog.btrim(s.value), '') ~ '^[0-9]+$'
      then 'https://www.facebook.com/groups/' || pg_catalog.btrim(s.value) || '/user/'
    else null
  end
  into group_member_base_url
  from public.settings s
  where s.key = 'facebook_group_id';

  for request_record in
    select *
    from public.registration_requests
    where id = any(request_ids_input)
    order by id
    for update
  loop
    select *
    into package_record
    from public.business_types
    where id = request_record.business_type_id
      and is_active = true
    for share;

    if not found or package_record.price_per_month is null or package_record.price_per_month < 0 then
      raise exception 'Loại hình kinh doanh không tồn tại, không hoạt động hoặc thiếu giá.' using errcode = '22023';
    end if;
    if request_record.months is null
      or request_record.months < 1
      or coalesce(request_record.discount, 0) <> 0 then
      raise exception 'Thời hạn không hợp lệ hoặc đăng ký công khai chứa giảm giá không được phép.' using errcode = '22023';
    end if;

    item_total := package_record.price_per_month * request_record.months;
    if item_total <= 0 or request_record.total_amount is distinct from item_total then
      raise exception 'Tổng tiền Kiosk không khớp giá hiện hành.' using errcode = '22023';
    end if;

    if request_record.kiosk_id is not null then
      select * into kiosk_record from public.kiosks where id = request_record.kiosk_id for update;
    else
      kiosk_record := null;
    end if;

    if kiosk_record.id is null then
      insert into public.kiosks(
        customer_id, facebook_name, facebook_id, facebook_link, facebook_group_link,
        category_id, business_type_id, service_name, start_date, end_date,
        status, auto_approve, total_paid, kiosk_total_paid, last_payment_date,
        note, is_primary
      ) values (
        customer_record.id,
        request_record.facebook_name,
        nullif(request_record.facebook_id, ''),
        request_record.facebook_link,
        case
          when group_member_base_url is null or nullif(request_record.facebook_id, '') is null then null
          else group_member_base_url || request_record.facebook_id || '/'
        end,
        package_record.category_id,
        package_record.id,
        package_record.name,
        null, null, 'pending', false, 0, 0, null,
        request_record.note,
        not exists (
          select 1 from public.kiosks k where k.customer_id = customer_record.id and k.is_primary
        )
      ) returning * into kiosk_record;
    elsif kiosk_record.customer_id <> customer_record.id then
      raise exception 'Kiosk không thuộc khách hàng của lô đăng ký.' using errcode = '23505';
    end if;

    first_kiosk_id := coalesce(first_kiosk_id, kiosk_record.id);

    insert into public.registration_batch_items(
      batch_id, registration_request_id, kiosk_id, business_type_id,
      months, paid_months, bonus_months, effective_service_months,
      price_per_month, discount, total_amount, promotion_eligible
    ) values (
      batch_record.id, request_record.id, kiosk_record.id, package_record.id,
      request_record.months, request_record.months, 0, request_record.months,
      package_record.price_per_month, 0, item_total, false
    );

    update public.registration_requests
    set customer_id = customer_record.id,
        kiosk_id = kiosk_record.id,
        registration_batch_id = batch_record.id,
        metadata = coalesce(metadata, '{}'::jsonb)
          || pg_catalog.jsonb_build_object('materialized_for_batch_payos_at', pg_catalog.now())
    where id = request_record.id;

    authoritative_total := authoritative_total + item_total;
    result_items := result_items || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'requestId', request_record.id,
      'kioskId', kiosk_record.id,
      'name', kiosk_record.facebook_name,
      'months', request_record.months,
      'pricePerMonth', package_record.price_per_month,
      'discount', 0,
      'totalAmount', item_total
    ));
  end loop;

  if authoritative_total <= 0 then
    raise exception 'Tổng tiền lô đăng ký không hợp lệ.' using errcode = '22023';
  end if;

  insert into public.payments(
    customer_id, kiosk_id, start_date, end_date, months, price_per_month,
    discount, total_amount, payment_method, payment_status, transaction_type,
    note, payment_intent_key, registration_batch_id
  ) values (
    customer_record.id, first_kiosk_id, null, null, 1, authoritative_total,
    0, authoritative_total, 'transfer', 'pending', 'standard',
    'Public registration batch #' || batch_record.id,
    'registration-batch:' || batch_record.id,
    batch_record.id
  ) returning * into payment_record;

  update public.registration_batches
  set payment_id = payment_record.id,
      total_amount = authoritative_total,
      updated_at = pg_catalog.now()
  where id = batch_record.id
  returning * into batch_record;

  update public.registration_requests
  set payment_id = payment_record.id
  where registration_batch_id = batch_record.id;

  update public.customers c
  set total_kiosks = (
    select pg_catalog.count(*) from public.kiosks k where k.customer_id = c.id
  )
  where c.id = customer_record.id;

  return pg_catalog.jsonb_build_object(
    'batch', pg_catalog.to_jsonb(batch_record),
    'payment', pg_catalog.to_jsonb(payment_record),
    'items', result_items,
    'reused', false
  );
end;
$function$;
revoke all on function public.prepare_registration_payment_v2(bigint[], text)
  from public, anon, authenticated;
grant execute on function public.prepare_registration_payment_v2(bigint[], text)
  to service_role;
