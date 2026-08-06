create or replace function public.submit_public_registration(
  customer_input jsonb,
  kiosks_input jsonb,
  bill_input jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  kiosk_item jsonb;
  bt public.business_types%rowtype;
  request_id_value bigint;
  result_items jsonb := '[]'::jsonb;
  item_number integer := 0;
  months_value integer;
  discount_value numeric;
  start_on date;
  end_on date;
  total_value numeric;
  customer_name text := nullif(trim(customer_input->>'facebook_name'), '');
  customer_phone text := nullif(trim(customer_input->>'phone'), '');
begin
  if customer_input is null or jsonb_typeof(customer_input) <> 'object'
    or customer_name is null or customer_phone is null then
    raise exception 'Tên Facebook và số điện thoại là bắt buộc.' using errcode = '22023';
  end if;
  if kiosks_input is null or jsonb_typeof(kiosks_input) <> 'array'
    or jsonb_array_length(kiosks_input) < 1 or jsonb_array_length(kiosks_input) > 20 then
    raise exception 'Cần đăng ký từ 1 đến 20 kiosk.' using errcode = '22023';
  end if;

  for kiosk_item in select value from jsonb_array_elements(kiosks_input)
  loop
    item_number := item_number + 1;
    if nullif(trim(kiosk_item->>'facebook_name'), '') is null
      or nullif(trim(kiosk_item->>'facebook_link'), '') is null then
      raise exception 'Kiosk số % cần tên Facebook và link Facebook.', item_number using errcode = '22023';
    end if;

    begin
      months_value := (kiosk_item->>'months')::integer;
      discount_value := coalesce((kiosk_item->>'discount')::numeric, 0);
      select * into bt
      from public.business_types
      where id = (kiosk_item->>'business_type_id')::bigint
        and is_active = true;
    exception when invalid_text_representation then
      raise exception 'Thông tin dịch vụ của kiosk số % không hợp lệ.', item_number using errcode = '22023';
    end;
    if not found then
      raise exception 'Dịch vụ của kiosk số % không hoạt động.', item_number using errcode = '22023';
    end if;

    request_id_value := public.submit_registration_request(
      kiosk_item->>'facebook_name',
      customer_phone,
      null,
      kiosk_item->>'facebook_link',
      customer_input->>'address',
      coalesce(kiosk_item->>'note', customer_input->>'note'),
      bt.category_id,
      bt.id,
      months_value,
      discount_value,
      kiosk_item->>'discount_reason'
    );

    start_on := (pg_catalog.now() at time zone 'Europe/Berlin')::date;
    end_on := (start_on + pg_catalog.make_interval(months => months_value))::date;
    total_value := (bt.price_per_month * months_value) - discount_value;
    result_items := result_items || jsonb_build_array(jsonb_build_object(
      'request', jsonb_build_object('id', request_id_value, 'status', 'pending'),
      'preview', jsonb_build_object(
        'startDate', start_on,
        'endDate', end_on,
        'months', months_value,
        'pricePerMonth', bt.price_per_month,
        'discount', discount_value,
        'totalAmount', total_value
      ),
      'businessType', jsonb_build_object('id', bt.id, 'name', bt.name)
    ));
  end loop;

  return jsonb_build_object(
    'customer', jsonb_build_object(
      'facebook_name', customer_name,
      'facebook_link', nullif(trim(customer_input->>'facebook_link'), ''),
      'phone', customer_phone
    ),
    'kiosks', result_items,
    'status', 'pending',
    'bill_received', bill_input is not null and bill_input <> 'null'::jsonb
  );
end;
$function$;

do $migration$
declare
  function_sql text;
  updated_sql text;
begin
  function_sql := pg_get_functiondef(
    'public.submit_public_legacy_registration(jsonb,jsonb)'::regprocedure
  );
  updated_sql := replace(
    function_sql,
    $old$
    if facebook_id_value is null or facebook_link_value is null then
      raise exception 'Kiosk số % cần Facebook ID và link Facebook.', item_number using errcode = '22023';
    end if;
    if facebook_id_value = any(resolved_ids) then
      raise exception 'Facebook ID bị trùng trong cùng yêu cầu.' using errcode = '23505';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('public-legacy:' || facebook_id_value, 0));
    if exists (select 1 from public.kiosks k where k.facebook_id = facebook_id_value)
      or exists (select 1 from public.customers c where c.facebook_id = facebook_id_value)
      or exists (
        select 1 from public.registration_requests r
        where r.facebook_id = facebook_id_value and r.status = 'pending'
      ) then
      raise exception 'Facebook ID đã được sử dụng hoặc đang chờ Ban quản trị xử lý.' using errcode = '23505';
    end if;
$old$,
    $new$
    if facebook_link_value is null then
      raise exception 'Kiosk số % cần link Facebook.', item_number using errcode = '22023';
    end if;
    if facebook_id_value is not null then
      if facebook_id_value = any(resolved_ids) then
        raise exception 'Facebook ID bị trùng trong cùng yêu cầu.' using errcode = '23505';
      end if;

      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('public-legacy:' || facebook_id_value, 0));
      if exists (select 1 from public.kiosks k where k.facebook_id = facebook_id_value)
        or exists (select 1 from public.customers c where c.facebook_id = facebook_id_value)
        or exists (
          select 1 from public.registration_requests r
          where r.facebook_id = facebook_id_value and r.status = 'pending'
        ) then
        raise exception 'Facebook ID đã được sử dụng hoặc đang chờ Ban quản trị xử lý.' using errcode = '23505';
      end if;
    end if;
$new$
  );
  if updated_sql = function_sql then
    raise exception 'Không tìm thấy khối Facebook ID của submit_public_legacy_registration để cập nhật.';
  end if;
  execute updated_sql;
end;
$migration$;

revoke all on function public.submit_public_registration(jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.submit_public_registration(jsonb, jsonb, jsonb) to anon, authenticated;

revoke all on function public.submit_public_legacy_registration(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.submit_public_legacy_registration(jsonb, jsonb) to anon, authenticated;
