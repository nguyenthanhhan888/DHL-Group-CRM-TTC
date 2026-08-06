create table if not exists public.registration_request_bills (
  id bigint primary key generated always as identity,
  registration_request_id bigint not null unique
    references public.registration_requests(id) on delete restrict,
  file_name text not null,
  mime_type text not null,
  file_size integer not null check (file_size between 1 and 5242880),
  content bytea not null,
  created_at timestamptz not null default now()
);

alter table public.registration_request_bills enable row level security;
revoke all on table public.registration_request_bills from public, anon, authenticated;
revoke all on sequence public.registration_request_bills_id_seq from public, anon, authenticated;

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
  customer_record public.customers%rowtype;
  kiosk_record public.kiosks%rowtype;
  payment_record public.payments%rowtype;
  request_record public.registration_requests%rowtype;
  business_type_record public.business_types%rowtype;
  kiosk_item jsonb;
  kiosk_results jsonb := '[]'::jsonb;
  warning_results jsonb := '[]'::jsonb;
  resolved_ids text[] := array[]::text[];
  resolved_facebook_id text;
  facebook_link text;
  customer_name text := nullif(trim(customer_input->>'facebook_name'), '');
  customer_phone text := nullif(trim(customer_input->>'phone'), '');
  normalized_phone text;
  months_value integer;
  discount_value numeric;
  subtotal_value numeric;
  total_value numeric;
  discount_reason_value text;
  bill_bytes bytea;
  bill_name text;
  bill_mime text;
  bill_size integer;
  item_number integer := 0;
  first_request boolean := true;
  group_member_base_url text;
begin
  if customer_input is null or jsonb_typeof(customer_input) <> 'object' then
    raise exception 'Thông tin khách hàng không hợp lệ.' using errcode = '22023';
  end if;

  if customer_name is null then
    raise exception 'Tên khách hàng là bắt buộc.' using errcode = '22023';
  end if;

  if customer_phone is null then
    raise exception 'Số điện thoại là bắt buộc.' using errcode = '22023';
  end if;

  if kiosks_input is null
    or jsonb_typeof(kiosks_input) <> 'array'
    or jsonb_array_length(kiosks_input) < 1
    or jsonb_array_length(kiosks_input) > 20 then
    raise exception 'Cần đăng ký từ 1 đến 20 kiosk.' using errcode = '22023';
  end if;

  normalized_phone := regexp_replace(customer_phone, '[^0-9+]', '', 'g');
  if normalized_phone = '' then
    raise exception 'Số điện thoại không hợp lệ.' using errcode = '22023';
  end if;
  if exists (
    select 1
    from public.customers c
    where regexp_replace(coalesce(c.phone, ''), '[^0-9+]', '', 'g') = normalized_phone
  ) then
    warning_results := warning_results || jsonb_build_array(jsonb_build_object(
      'code', 'DUPLICATE_PHONE',
      'message', 'Số điện thoại đã tồn tại; đăng ký vẫn được tạo cho khách hàng mới.'
    ));
  end if;

  -- Resolve and lock every Facebook ID before creating any record. The advisory
  -- locks serialize concurrent public submissions for the same external ID.
  for kiosk_item in select value from jsonb_array_elements(kiosks_input)
  loop
    item_number := item_number + 1;
    resolved_facebook_id := nullif(regexp_replace(coalesce(kiosk_item->>'facebook_id', ''), '[^0-9]', '', 'g'), '');
    facebook_link := nullif(trim(kiosk_item->>'facebook_link'), '');

    if resolved_facebook_id is null and facebook_link is not null then
      if facebook_link ~ '[?&]id=[0-9]+' then
        resolved_facebook_id := substring(facebook_link from '[?&]id=([0-9]+)');
      elsif facebook_link ~ '/[0-9]+/?' then
        resolved_facebook_id := substring(facebook_link from '/([0-9]+)/?');
      end if;
    end if;

    if resolved_facebook_id is null then
      raise exception 'Không thể xác định Facebook ID cho kiosk số %.', item_number
        using errcode = '22023';
    end if;

    if resolved_facebook_id = any(resolved_ids) then
      raise exception 'Facebook ID bị trùng trong cùng đăng ký.'
        using errcode = '23505';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(resolved_facebook_id, 0));

    if exists (select 1 from public.kiosks k where k.facebook_id = resolved_facebook_id)
      or exists (select 1 from public.customers c where c.facebook_id = resolved_facebook_id)
      or exists (
        select 1
        from public.registration_requests r
        where r.facebook_id = resolved_facebook_id
          and lower(coalesce(r.status, 'pending')) = 'pending'
      ) then
      raise exception 'Facebook ID đã được sử dụng.'
        using errcode = '23505';
    end if;

    resolved_ids := array_append(resolved_ids, resolved_facebook_id);
  end loop;

  if bill_input is not null and bill_input <> 'null'::jsonb then
    if jsonb_typeof(bill_input) <> 'object' then
      raise exception 'Tệp hóa đơn không hợp lệ.' using errcode = '22023';
    end if;

    bill_name := nullif(trim(bill_input->>'file_name'), '');
    bill_mime := lower(nullif(trim(bill_input->>'mime_type'), ''));
    if bill_name is null
      or bill_mime not in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')
      or nullif(bill_input->>'content_base64', '') is null then
      raise exception 'Hóa đơn phải là JPG, PNG, WEBP hoặc PDF.'
        using errcode = '22023';
    end if;

    begin
      bill_bytes := decode(bill_input->>'content_base64', 'base64');
    exception when others then
      raise exception 'Dữ liệu hóa đơn không hợp lệ.' using errcode = '22023';
    end;
    bill_size := octet_length(bill_bytes);
    if bill_size < 1 or bill_size > 5242880 then
      raise exception 'Hóa đơn phải nhỏ hơn hoặc bằng 5 MB.' using errcode = '22023';
    end if;
  end if;

  select case
    when nullif(trim(s.value), '') ~ '^[0-9]+$'
      then 'https://www.facebook.com/groups/' || trim(s.value) || '/user/'
    else null
  end
  into group_member_base_url
  from public.settings s
  where s.key = 'facebook_group_id';

  insert into public.customers(
    facebook_name,
    facebook_id,
    facebook_link,
    facebook_group_link,
    phone,
    address,
    note,
    total_kiosks,
    total_paid
  )
  values(
    customer_name,
    resolved_ids[1],
    nullif(trim(customer_input->>'facebook_link'), ''),
    case when group_member_base_url is null then null else group_member_base_url || resolved_ids[1] || '/' end,
    customer_phone,
    nullif(trim(customer_input->>'address'), ''),
    nullif(trim(customer_input->>'note'), ''),
    0,
    0
  )
  returning * into customer_record;

  item_number := 0;
  for kiosk_item in select value from jsonb_array_elements(kiosks_input)
  loop
    item_number := item_number + 1;
    resolved_facebook_id := resolved_ids[item_number];
    facebook_link := nullif(trim(kiosk_item->>'facebook_link'), '');

    begin
      months_value := (kiosk_item->>'months')::integer;
      discount_value := coalesce((kiosk_item->>'discount')::numeric, 0);
    exception when others then
      raise exception 'Thời hạn hoặc giảm giá của kiosk số % không hợp lệ.', item_number
        using errcode = '22023';
    end;

    if months_value < 1 or months_value > 120 then
      raise exception 'Số tháng của kiosk số % phải từ 1 đến 120.', item_number
        using errcode = '22023';
    end if;

    begin
      select *
      into business_type_record
      from public.business_types bt
      where bt.id = (kiosk_item->>'business_type_id')::bigint
        and bt.is_active = true;
    exception when invalid_text_representation then
      raise exception 'Loại hình kinh doanh của kiosk số % không hợp lệ.', item_number
        using errcode = '22023';
    end;

    if not found then
      raise exception 'Loại hình kinh doanh của kiosk số % không hoạt động.', item_number
        using errcode = '22023';
    end if;

    subtotal_value := business_type_record.price_per_month * months_value;
    if discount_value < 0 or discount_value > subtotal_value then
      raise exception 'Giảm giá của kiosk số % không hợp lệ.', item_number
        using errcode = '22023';
    end if;

    discount_reason_value := nullif(trim(kiosk_item->>'discount_reason'), '');
    if discount_value > 0 and discount_reason_value is null then
      raise exception 'Cần nhập lý do giảm giá cho kiosk số %.', item_number
        using errcode = '22023';
    end if;
    total_value := subtotal_value - discount_value;

    insert into public.kiosks(
      customer_id,
      facebook_name,
      facebook_id,
      facebook_link,
      facebook_group_link,
      category_id,
      business_type_id,
      start_date,
      end_date,
      status,
      auto_approve,
      note
    )
    values(
      customer_record.id,
      coalesce(nullif(trim(kiosk_item->>'facebook_name'), ''), customer_name),
      resolved_facebook_id,
      facebook_link,
      case when group_member_base_url is null then null else group_member_base_url || resolved_facebook_id || '/' end,
      business_type_record.category_id,
      business_type_record.id,
      null,
      null,
      'pending',
      false,
      nullif(trim(kiosk_item->>'note'), '')
    )
    returning * into kiosk_record;

    insert into public.payments(
      customer_id,
      kiosk_id,
      start_date,
      end_date,
      months,
      price_per_month,
      discount,
      discount_reason,
      total_amount,
      payment_method,
      payment_status,
      note
    )
    values(
      customer_record.id,
      kiosk_record.id,
      null,
      null,
      months_value,
      business_type_record.price_per_month,
      discount_value,
      discount_reason_value,
      total_value,
      'transfer',
      'pending',
      coalesce(nullif(trim(kiosk_item->>'note'), ''), nullif(trim(customer_input->>'note'), ''))
    )
    returning * into payment_record;

    insert into public.registration_requests(
      customer_id,
      kiosk_id,
      facebook_name,
      facebook_id,
      facebook_link,
      phone,
      service_name,
      months,
      total_amount,
      status,
      submitted_at
    )
    values(
      customer_record.id,
      kiosk_record.id,
      kiosk_record.facebook_name,
      resolved_facebook_id,
      facebook_link,
      customer_phone,
      business_type_record.name,
      months_value,
      total_value,
      'pending',
      pg_catalog.now()
    )
    returning * into request_record;

    if first_request and bill_bytes is not null then
      insert into public.registration_request_bills(
        registration_request_id,
        file_name,
        mime_type,
        file_size,
        content
      )
      values(
        request_record.id,
        bill_name,
        bill_mime,
        bill_size,
        bill_bytes
      );
    end if;

    kiosk_results := kiosk_results || jsonb_build_array(jsonb_build_object(
      'kiosk', to_jsonb(kiosk_record),
      'payment', to_jsonb(payment_record),
      'request', to_jsonb(request_record),
      'businessType', to_jsonb(business_type_record),
      'preview', jsonb_build_object(
        'businessTypeName', business_type_record.name,
        'categoryId', business_type_record.category_id,
        'months', months_value,
        'pricePerMonth', business_type_record.price_per_month,
        'subtotal', subtotal_value,
        'discount', discount_value,
        'totalAmount', total_value
      )
    ));
    first_request := false;
  end loop;

  update public.customers c
  set total_kiosks = (
    select count(*)::integer
    from public.kiosks k
    where k.customer_id = customer_record.id
  )
  where c.id = customer_record.id
  returning * into customer_record;

  insert into public.audit_logs(
    actor_id,
    actor_name,
    actor_role,
    module,
    action,
    before,
    after,
    reason
  )
  values(
    auth.uid(),
    customer_name,
    case when auth.uid() is null then 'anon' else 'authenticated' end,
    'Registration',
    'submit_public_registration',
    null,
    jsonb_build_object(
      'customer_id', customer_record.id,
      'kiosk_ids', (
        select coalesce(jsonb_agg((entry->'kiosk'->>'id')::bigint), '[]'::jsonb)
        from jsonb_array_elements(kiosk_results) entry
      ),
      'request_ids', (
        select coalesce(jsonb_agg((entry->'request'->>'id')::bigint), '[]'::jsonb)
        from jsonb_array_elements(kiosk_results) entry
      ),
      'bill_attached', bill_bytes is not null,
      'warnings', warning_results
    ),
    'Đăng ký công khai được tạo trong một giao dịch'
  );

  return jsonb_build_object(
    'customer', to_jsonb(customer_record),
    'kiosks', kiosk_results,
    'warnings', warning_results,
    'billAttached', bill_bytes is not null
  );
end;
$function$;

revoke all on function public.submit_public_registration(jsonb, jsonb, jsonb) from public;
revoke all on function public.submit_public_registration(jsonb, jsonb, jsonb) from anon;
revoke all on function public.submit_public_registration(jsonb, jsonb, jsonb) from authenticated;
grant execute on function public.submit_public_registration(jsonb, jsonb, jsonb) to anon, authenticated;
