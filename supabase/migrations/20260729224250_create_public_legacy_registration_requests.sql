create or replace function public.submit_public_legacy_registration(
  customer_input jsonb,
  kiosks_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  kiosk_item jsonb;
  business_type_record public.business_types%rowtype;
  request_record public.registration_requests%rowtype;
  request_ids jsonb := '[]'::jsonb;
  resolved_ids text[] := array[]::text[];
  customer_name text := nullif(trim(customer_input->>'facebook_name'), '');
  customer_phone text := nullif(trim(customer_input->>'phone'), '');
  customer_facebook_id text := nullif(regexp_replace(coalesce(customer_input->>'facebook_id', ''), '[^0-9]', '', 'g'), '');
  facebook_id_value text;
  facebook_link_value text;
  start_date_value date;
  end_date_value date;
  amount_value numeric;
  category_id_value bigint;
  item_number integer := 0;
  request_code uuid := gen_random_uuid();
begin
  if customer_input is null or jsonb_typeof(customer_input) <> 'object'
    or customer_name is null or customer_phone is null then
    raise exception 'Tên Facebook và số điện thoại khách hàng là bắt buộc.' using errcode = '22023';
  end if;
  if customer_phone !~ '^\+?[0-9 .()-]{9,20}$' then
    raise exception 'Số điện thoại không hợp lệ.' using errcode = '22023';
  end if;
  if kiosks_input is null or jsonb_typeof(kiosks_input) <> 'array'
    or jsonb_array_length(kiosks_input) < 1 or jsonb_array_length(kiosks_input) > 20 then
    raise exception 'Cần bổ sung từ 1 đến 20 kiosk.' using errcode = '22023';
  end if;

  for kiosk_item in select value from jsonb_array_elements(kiosks_input)
  loop
    item_number := item_number + 1;
    facebook_id_value := nullif(regexp_replace(coalesce(kiosk_item->>'facebook_id', ''), '[^0-9]', '', 'g'), '');
    facebook_link_value := nullif(trim(kiosk_item->>'facebook_link'), '');
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

    begin
      category_id_value := (kiosk_item->>'category_id')::bigint;
      start_date_value := (kiosk_item->>'start_date')::date;
      end_date_value := (kiosk_item->>'end_date')::date;
      amount_value := (kiosk_item->>'amount')::numeric;
      select * into business_type_record
      from public.business_types bt
      where bt.id = (kiosk_item->>'business_type_id')::bigint
        and bt.category_id = category_id_value
        and bt.is_active = true;
    exception when invalid_text_representation or datetime_field_overflow then
      raise exception 'Danh mục, dịch vụ, ngày hoặc số tiền của kiosk số % không hợp lệ.', item_number using errcode = '22023';
    end;
    if not found then
      raise exception 'Dịch vụ của kiosk số % không thuộc danh mục đã chọn hoặc không còn hoạt động.', item_number using errcode = '22023';
    end if;
    if amount_value < 0 or end_date_value < start_date_value then
      raise exception 'Số tiền hoặc thời hạn của kiosk số % không hợp lệ.', item_number using errcode = '22023';
    end if;

    resolved_ids := array_append(resolved_ids, facebook_id_value);
    insert into public.registration_requests(
      facebook_name, facebook_id, facebook_link, phone, service_name,
      category_id, business_type_id, requested_start_date, requested_end_date,
      total_amount, note, status, metadata
    ) values (
      coalesce(nullif(trim(kiosk_item->>'facebook_name'), ''), customer_name),
      facebook_id_value, facebook_link_value, customer_phone, business_type_record.name,
      business_type_record.category_id, business_type_record.id, start_date_value, end_date_value,
      amount_value, nullif(trim(kiosk_item->>'note'), ''), 'pending',
      jsonb_build_object(
        'request_type', 'legacy',
        'request_code', request_code::text,
        'customer', jsonb_build_object(
          'facebook_name', customer_name,
          'facebook_id', customer_facebook_id,
          'facebook_link', nullif(trim(customer_input->>'facebook_link'), ''),
          'phone', customer_phone
        ),
        'bill_confirmed_via_zalo', true
      )
    ) returning * into request_record;
    request_ids := request_ids || jsonb_build_array(request_record.id);
  end loop;

  return jsonb_build_object(
    'request_code', request_code::text,
    'request_ids', request_ids,
    'count', jsonb_array_length(request_ids),
    'status', 'pending'
  );
end;
$function$;

revoke all on function public.submit_public_legacy_registration(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.submit_public_legacy_registration(jsonb, jsonb) to anon, authenticated;
