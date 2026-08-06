create table if not exists public.legacy_registration_requests (
  id bigint primary key generated always as identity,
  customer_id bigint not null references public.customers(id) on delete restrict,
  kiosk_id bigint not null references public.kiosks(id) on delete restrict,
  payment_id bigint not null unique references public.payments(id) on delete restrict,
  requested_start_date date not null,
  requested_end_date date not null,
  legacy_amount numeric not null check (legacy_amount >= 0),
  status text not null default 'pending'
    check (lower(status) in ('pending', 'approved', 'rejected', 'cancelled')),
  note text,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id) on delete restrict,
  reviewed_at timestamptz
);

alter table public.legacy_registration_requests enable row level security;
revoke all on table public.legacy_registration_requests from public, anon, authenticated;
revoke all on sequence public.legacy_registration_requests_id_seq from public, anon, authenticated;

create index if not exists legacy_registration_requests_customer_idx
  on public.legacy_registration_requests(customer_id);
create index if not exists legacy_registration_requests_kiosk_idx
  on public.legacy_registration_requests(kiosk_id);
create index if not exists legacy_registration_requests_status_idx
  on public.legacy_registration_requests(status, created_at);

create or replace function private.assert_legacy_registration_permission()
returns public.user_roles
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  actor public.user_roles%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Bạn phải đăng nhập để bổ sung dữ liệu cũ.'
      using errcode = '42501';
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
          and 'legacy-registration' = any(rp.permissions)
      )
    );

  if not found then
    raise exception 'Không có quyền bổ sung dữ liệu cũ.'
      using errcode = '42501';
  end if;

  return actor;
end;
$function$;

create or replace function public.submit_legacy_registration(
  customer_input jsonb,
  kiosks_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor public.user_roles%rowtype;
  customer_record public.customers%rowtype;
  facebook_customer public.customers%rowtype;
  phone_customer public.customers%rowtype;
  kiosk_record public.kiosks%rowtype;
  payment_record public.payments%rowtype;
  request_record public.legacy_registration_requests%rowtype;
  business_type_record public.business_types%rowtype;
  kiosk_item jsonb;
  result_items jsonb := '[]'::jsonb;
  resolved_ids text[] := array[]::text[];
  resolved_facebook_id text;
  customer_name text := nullif(trim(customer_input->>'facebook_name'), '');
  customer_phone text := nullif(trim(customer_input->>'phone'), '');
  customer_facebook_id text := nullif(regexp_replace(coalesce(customer_input->>'facebook_id', ''), '[^0-9]', '', 'g'), '');
  normalized_phone text;
  start_date_value date;
  end_date_value date;
  months_value integer;
  amount_value numeric;
  expected_amount numeric;
  discount_value numeric;
  item_number integer := 0;
  phone_match_count integer := 0;
  customer_created boolean := false;
  group_member_base_url text;
begin
  actor := private.assert_legacy_registration_permission();

  if customer_input is null or jsonb_typeof(customer_input) <> 'object' then
    raise exception 'Thông tin khách hàng không hợp lệ.' using errcode = '22023';
  end if;
  if customer_name is null or customer_phone is null then
    raise exception 'Tên Facebook và số điện thoại khách hàng là bắt buộc.'
      using errcode = '22023';
  end if;
  if kiosks_input is null
    or jsonb_typeof(kiosks_input) <> 'array'
    or jsonb_array_length(kiosks_input) < 1
    or jsonb_array_length(kiosks_input) > 50 then
    raise exception 'Cần bổ sung từ 1 đến 50 kiosk.' using errcode = '22023';
  end if;

  normalized_phone := regexp_replace(customer_phone, '[^0-9+]', '', 'g');
  if normalized_phone = '' then
    raise exception 'Số điện thoại khách hàng không hợp lệ.' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('legacy-customer-phone:' || normalized_phone, 0)
  );
  if customer_facebook_id is not null then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('legacy-customer-facebook:' || customer_facebook_id, 0)
    );
  end if;

  if customer_facebook_id is not null then
    select *
    into facebook_customer
    from public.customers c
    where c.facebook_id = customer_facebook_id
    order by c.id
    limit 1;
  end if;

  select count(*)::integer, min(c.id)
  into phone_match_count, phone_customer.id
  from public.customers c
  where regexp_replace(coalesce(c.phone, ''), '[^0-9+]', '', 'g') = normalized_phone;

  if phone_match_count = 1 then
    select * into phone_customer
    from public.customers c
    where c.id = phone_customer.id;
  elsif phone_match_count > 1 and facebook_customer.id is null then
    raise exception 'Có nhiều khách hàng cùng số điện thoại. Hãy chọn khách hàng hiện có bằng công cụ quản trị.'
      using errcode = 'P0001';
  elsif phone_match_count > 1 then
    phone_customer := null;
  end if;

  if facebook_customer.id is not null
    and phone_customer.id is not null
    and facebook_customer.id <> phone_customer.id then
    raise exception 'Facebook ID và số điện thoại thuộc hai khách hàng khác nhau.'
      using errcode = 'P0001';
  end if;

  if facebook_customer.id is null
    and phone_customer.id is not null
    and customer_facebook_id is not null
    and phone_customer.facebook_id is not null
    and phone_customer.facebook_id <> customer_facebook_id then
    raise exception 'Facebook ID không khớp với khách hàng tìm thấy theo số điện thoại.'
      using errcode = 'P0001';
  end if;

  customer_record := coalesce(facebook_customer, phone_customer);

  -- Resolve every ID and take transaction locks before writing any record.
  for kiosk_item in select value from jsonb_array_elements(kiosks_input)
  loop
    item_number := item_number + 1;
    resolved_facebook_id := nullif(regexp_replace(coalesce(kiosk_item->>'facebook_id', ''), '[^0-9]', '', 'g'), '');
    if resolved_facebook_id is null and nullif(trim(kiosk_item->>'facebook_link'), '') is not null then
      if kiosk_item->>'facebook_link' ~ '[?&]id=[0-9]+' then
        resolved_facebook_id := substring(kiosk_item->>'facebook_link' from '[?&]id=([0-9]+)');
      elsif kiosk_item->>'facebook_link' ~ '/[0-9]+/?' then
        resolved_facebook_id := substring(kiosk_item->>'facebook_link' from '/([0-9]+)/?');
      end if;
    end if;

    if resolved_facebook_id is null then
      raise exception 'Không thể xác định Facebook ID cho kiosk số %.', item_number
        using errcode = '22023';
    end if;
    if resolved_facebook_id = any(resolved_ids) then
      raise exception 'Facebook ID bị trùng trong cùng hồ sơ.'
        using errcode = '23505';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(resolved_facebook_id, 0));
    if exists (select 1 from public.kiosks k where k.facebook_id = resolved_facebook_id)
      or exists (
        select 1 from public.registration_requests r
        where r.facebook_id = resolved_facebook_id
          and lower(coalesce(r.status, 'pending')) = 'pending'
      )
      or exists (
        select 1
        from public.legacy_registration_requests lr
        join public.kiosks lk on lk.id = lr.kiosk_id
        where lk.facebook_id = resolved_facebook_id
          and lower(lr.status) = 'pending'
      ) then
      raise exception 'Facebook ID đã được sử dụng.'
        using errcode = '23505';
    end if;
    resolved_ids := array_append(resolved_ids, resolved_facebook_id);
  end loop;

  select case
    when nullif(trim(s.value), '') ~ '^[0-9]+$'
      then 'https://www.facebook.com/groups/' || trim(s.value) || '/user/'
    else null
  end
  into group_member_base_url
  from public.settings s
  where s.key = 'facebook_group_id';

  if customer_record.id is null then
    insert into public.customers(
      facebook_name,
      facebook_id,
      facebook_link,
      facebook_group_link,
      phone,
      status,
      note,
      total_kiosks,
      total_paid
    )
    values(
      customer_name,
      customer_facebook_id,
      nullif(trim(customer_input->>'facebook_link'), ''),
      case when customer_facebook_id is not null
          and group_member_base_url is not null
        then group_member_base_url || customer_facebook_id || '/'
      end,
      customer_phone,
      'active',
      nullif(trim(customer_input->>'note'), ''),
      0,
      0
    )
    returning * into customer_record;
    customer_created := true;
  end if;

  perform 1 from public.customers c where c.id = customer_record.id for update;

  item_number := 0;
  for kiosk_item in select value from jsonb_array_elements(kiosks_input)
  loop
    item_number := item_number + 1;
    resolved_facebook_id := resolved_ids[item_number];

    begin
      start_date_value := (kiosk_item->>'start_date')::date;
      end_date_value := (kiosk_item->>'end_date')::date;
      amount_value := (kiosk_item->>'amount')::numeric;
    exception when others then
      raise exception 'Ngày hoặc số tiền của kiosk số % không hợp lệ.', item_number
        using errcode = '22023';
    end;

    if end_date_value < start_date_value then
      raise exception 'Ngày hết hạn của kiosk số % phải từ ngày đăng ký trở đi.', item_number
        using errcode = '22023';
    end if;
    months_value := (
      (extract(year from end_date_value)::integer - extract(year from start_date_value)::integer) * 12
      + extract(month from end_date_value)::integer
      - extract(month from start_date_value)::integer
    );
    if months_value < 1 then
      raise exception 'Khoảng thời gian của kiosk số % phải tối thiểu 1 tháng.', item_number
        using errcode = '22023';
    end if;
    if amount_value <= 0 then
      raise exception 'Số tiền của kiosk số % không hợp lệ.', item_number
        using errcode = '22023';
    end if;

    begin
      select *
      into business_type_record
      from public.business_types bt
      where bt.id = (kiosk_item->>'business_type_id')::bigint
        and bt.is_active = true;
    exception when invalid_text_representation then
      raise exception 'Dịch vụ của kiosk số % không hợp lệ.', item_number
        using errcode = '22023';
    end;
    if not found then
      raise exception 'Dịch vụ của kiosk số % không hoạt động.', item_number
        using errcode = '22023';
    end if;

    expected_amount := business_type_record.price_per_month * months_value;
    if amount_value > expected_amount then
      raise exception 'Số tiền của kiosk số % vượt quá giá gói cho kỳ đã chọn.', item_number
        using errcode = '22023';
    end if;
    discount_value := expected_amount - amount_value;

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
      nullif(trim(kiosk_item->>'facebook_link'), ''),
      coalesce(
        nullif(trim(kiosk_item->>'facebook_group_link'), ''),
        case when group_member_base_url is null then null else group_member_base_url || resolved_facebook_id || '/' end
      ),
      business_type_record.category_id,
      business_type_record.id,
      null,
      null,
      'pending',
      false,
      coalesce(nullif(trim(kiosk_item->>'note'), ''), nullif(trim(customer_input->>'note'), ''))
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
      case when discount_value > 0 then 'Điều chỉnh theo số tiền hồ sơ cũ' end,
      amount_value,
      'transfer',
      'pending',
      coalesce(nullif(trim(kiosk_item->>'note'), ''), 'Bổ sung hồ sơ khách hàng đã đăng ký trước đây.')
    )
    returning * into payment_record;

    insert into public.legacy_registration_requests(
      customer_id,
      kiosk_id,
      payment_id,
      requested_start_date,
      requested_end_date,
      legacy_amount,
      status,
      note,
      created_by
    )
    values(
      customer_record.id,
      kiosk_record.id,
      payment_record.id,
      start_date_value,
      end_date_value,
      amount_value,
      'pending',
      coalesce(nullif(trim(kiosk_item->>'note'), ''), nullif(trim(customer_input->>'note'), '')),
      actor.user_id
    )
    returning * into request_record;

    result_items := result_items || jsonb_build_array(jsonb_build_object(
      'kiosk', to_jsonb(kiosk_record),
      'payment', to_jsonb(payment_record),
      'legacyRequest', to_jsonb(request_record),
      'businessType', to_jsonb(business_type_record)
    ));
  end loop;

  update public.customers c
  set total_kiosks = (
    select count(*)::integer from public.kiosks k where k.customer_id = customer_record.id
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
    actor.user_id,
    coalesce(actor.display_name, actor.username, 'System'),
    actor.role,
    'Legacy Registration',
    'submit_legacy_registration',
    null,
    jsonb_build_object(
      'customer_id', customer_record.id,
      'kiosk_ids', (
        select coalesce(jsonb_agg((entry->'kiosk'->>'id')::bigint), '[]'::jsonb)
        from jsonb_array_elements(result_items) entry
      ),
      'payment_ids', (
        select coalesce(jsonb_agg((entry->'payment'->>'id')::bigint), '[]'::jsonb)
        from jsonb_array_elements(result_items) entry
      ),
      'legacy_request_ids', (
        select coalesce(jsonb_agg((entry->'legacyRequest'->>'id')::bigint), '[]'::jsonb)
        from jsonb_array_elements(result_items) entry
      )
    ),
    'Bổ sung dữ liệu cũ trong một giao dịch'
  );

  return jsonb_build_object(
    'customer', to_jsonb(customer_record),
    'items', result_items,
    'customerCreated', customer_created
  );
end;
$function$;

revoke all on function public.submit_legacy_registration(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.submit_legacy_registration(jsonb, jsonb) to authenticated;
