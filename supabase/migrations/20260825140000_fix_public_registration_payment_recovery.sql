-- Public PayOS registrations are provisional until the provider webhook
-- confirms payment. Keep that lifecycle separate from manual Admin review.
alter table public.registration_requests drop constraint registration_requests_status_check;
alter table public.registration_requests add constraint registration_requests_status_check
  check (status in ('awaiting_payment', 'pending', 'approved', 'rejected'));

-- Reclassify only untouched modern public requests. Legacy/manual requests
-- retain request_type=legacy and remain Admin-review pending.
update public.registration_requests
set status = 'awaiting_payment',
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('workflow', 'public_payos')
where status = 'pending'
  and coalesce(metadata->>'request_type', '') <> 'legacy'
  and customer_id is null and kiosk_id is null
  and registration_batch_id is null and payment_id is null;

-- Explicit authoritative base implementation. This preserves the complete
-- pre-promotion batch contract and initializes every Promotion Engine V1
-- NOT NULL item column at materialization time.
create or replace function private.prepare_registration_batch_for_payos(
  request_ids_input bigint[], phone_input text
)
returns jsonb language plpgsql security definer set search_path = '' as $function$
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
  if request_count < 1 or request_count > 20 then raise exception 'Lô đăng ký phải có từ 1 đến 20 Kiosk.' using errcode = '22023'; end if;
  if normalized_phone = '' then raise exception 'Số điện thoại xác nhận không hợp lệ.' using errcode = '22023'; end if;
  if (select count(distinct value) from pg_catalog.unnest(request_ids_input) value) <> request_count then
    raise exception 'Danh sách yêu cầu đăng ký bị trùng.' using errcode = '22023';
  end if;
  batch_key := 'registration-batch:' || (select pg_catalog.string_agg(value::text, ',' order by value) from pg_catalog.unnest(request_ids_input) value);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(batch_key, 0));

  perform 1 from public.registration_requests where id = any(request_ids_input) order by id for update;
  select count(*) into request_count from public.registration_requests where id = any(request_ids_input);
  if request_count <> pg_catalog.array_length(request_ids_input, 1) then raise exception 'Không tìm thấy đầy đủ yêu cầu đăng ký.' using errcode = 'P0002'; end if;
  if exists (select 1 from public.registration_requests where id = any(request_ids_input)
    and pg_catalog.regexp_replace(coalesce(phone, ''), '[^0-9+]', '', 'g') <> normalized_phone) then
    raise exception 'Số điện thoại không khớp lô đăng ký.' using errcode = '42501';
  end if;
  if exists (select 1 from public.registration_requests where id = any(request_ids_input)
    and pg_catalog.lower(coalesce(status, 'pending')) not in ('awaiting_payment', 'pending', 'approved')) then
    raise exception 'Lô đăng ký không còn có thể thanh toán.' using errcode = '22023';
  end if;

  select b.* into batch_record from public.registration_batches b
  join public.registration_requests r on r.registration_batch_id = b.id
  where r.id = any(request_ids_input) order by b.id limit 1 for update of b;
  if found then
    if exists (select 1 from public.registration_requests where id = any(request_ids_input)
      and registration_batch_id is distinct from batch_record.id) then
      raise exception 'Yêu cầu đã thuộc lô đăng ký khác.' using errcode = '23505';
    end if;
    select * into payment_record from public.payments where id = batch_record.payment_id for update;
    return jsonb_build_object(
      'batch', to_jsonb(batch_record), 'payment', to_jsonb(payment_record),
      'items', (select coalesce(jsonb_agg(jsonb_build_object(
        'requestId', i.registration_request_id, 'kioskId', i.kiosk_id,
        'name', k.facebook_name, 'months', i.months,
        'pricePerMonth', i.price_per_month, 'discount', i.discount,
        'totalAmount', i.total_amount)), '[]'::jsonb)
        from public.registration_batch_items i join public.kiosks k on k.id = i.kiosk_id
        where i.batch_id = batch_record.id), 'reused', true);
  end if;

  select * into customer_record from public.customers
  where pg_catalog.regexp_replace(coalesce(phone, ''), '[^0-9+]', '', 'g') = normalized_phone
  order by id limit 1 for update;
  if not found then
    select * into request_record from public.registration_requests where id = any(request_ids_input) order by id limit 1;
    insert into public.customers(facebook_name, facebook_id, facebook_link, phone, address, status, total_kiosks, total_paid, note)
    values(request_record.facebook_name, nullif(request_record.facebook_id, ''), request_record.facebook_link,
      request_record.phone, request_record.address, 'pending', 0, 0, request_record.note)
    returning * into customer_record;
  end if;
  insert into public.registration_batches(customer_id, phone, status, total_amount)
  values(customer_record.id, normalized_phone, 'pending', 0) returning * into batch_record;
  select case when nullif(trim(s.value), '') ~ '^[0-9]+$'
    then 'https://www.facebook.com/groups/' || trim(s.value) || '/user/' else null end
  into group_member_base_url from public.settings s where s.key = 'facebook_group_id';

  for request_record in select * from public.registration_requests where id = any(request_ids_input) order by id for update loop
    select * into package_record from public.business_types
    where id = request_record.business_type_id and is_active = true for share;
    if not found or package_record.price_per_month is null or package_record.price_per_month < 0 then
      raise exception 'Loại hình kinh doanh không tồn tại, không hoạt động hoặc thiếu giá.' using errcode = '22023';
    end if;
    if request_record.months is null or request_record.months < 1 or coalesce(request_record.discount, 0) <> 0 then
      raise exception 'Thời hạn không hợp lệ hoặc đăng ký công khai chứa giảm giá không được phép.' using errcode = '22023';
    end if;
    item_total := package_record.price_per_month * request_record.months;
    if item_total <= 0 or request_record.total_amount is distinct from item_total then
      raise exception 'Tổng tiền Kiosk không khớp giá hiện hành.' using errcode = '22023';
    end if;
    if request_record.kiosk_id is not null then
      select * into kiosk_record from public.kiosks where id = request_record.kiosk_id for update;
    else kiosk_record := null;
    end if;
    if kiosk_record.id is null then
      insert into public.kiosks(customer_id, facebook_name, facebook_id, facebook_link, facebook_group_link,
        category_id, business_type_id, service_name, start_date, end_date, status, auto_approve,
        total_paid, kiosk_total_paid, last_payment_date, note, is_primary)
      values(customer_record.id, request_record.facebook_name, nullif(request_record.facebook_id, ''),
        request_record.facebook_link, case when group_member_base_url is null or nullif(request_record.facebook_id, '') is null
          then null else group_member_base_url || request_record.facebook_id || '/' end,
        package_record.category_id, package_record.id, package_record.name, null, null, 'pending', false,
        0, 0, null, request_record.note,
        not exists(select 1 from public.kiosks k where k.customer_id = customer_record.id and k.is_primary))
      returning * into kiosk_record;
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
      package_record.price_per_month, coalesce(request_record.discount, 0), item_total, false
    );
    update public.registration_requests
    set customer_id = customer_record.id, kiosk_id = kiosk_record.id,
        registration_batch_id = batch_record.id,
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('materialized_for_batch_payos_at', pg_catalog.now())
    where id = request_record.id;
    authoritative_total := authoritative_total + item_total;
    result_items := result_items || jsonb_build_array(jsonb_build_object(
      'requestId', request_record.id, 'kioskId', kiosk_record.id, 'name', kiosk_record.facebook_name,
      'months', request_record.months, 'pricePerMonth', package_record.price_per_month,
      'discount', coalesce(request_record.discount, 0), 'totalAmount', item_total));
  end loop;
  if authoritative_total <= 0 then raise exception 'Tổng tiền lô đăng ký không hợp lệ.' using errcode = '22023'; end if;
  insert into public.payments(customer_id, kiosk_id, start_date, end_date, months, price_per_month,
    discount, total_amount, payment_method, payment_status, transaction_type, note,
    payment_intent_key, registration_batch_id)
  values(customer_record.id, first_kiosk_id, null, null, 1, authoritative_total, 0, authoritative_total,
    'transfer', 'pending', 'standard', 'Public registration batch #' || batch_record.id,
    'registration-batch:' || batch_record.id, batch_record.id) returning * into payment_record;
  update public.registration_batches set payment_id = payment_record.id, total_amount = authoritative_total,
    updated_at = pg_catalog.now() where id = batch_record.id returning * into batch_record;
  update public.registration_requests set payment_id = payment_record.id where registration_batch_id = batch_record.id;
  update public.customers c set total_kiosks = (select count(*) from public.kiosks k where k.customer_id = c.id)
  where c.id = customer_record.id;
  return jsonb_build_object('batch', to_jsonb(batch_record), 'payment', to_jsonb(payment_record),
    'items', result_items, 'reused', false);
end;
$function$;
revoke all on function private.prepare_registration_batch_for_payos(bigint[], text) from public, anon, authenticated;
grant execute on function private.prepare_registration_batch_for_payos(bigint[], text) to service_role;

-- Duplicate protection covers both explicit workflow states.
create or replace function private.prevent_duplicate_pending_registration()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare identity_key text;
begin
  identity_key := coalesce(
    nullif(pg_catalog.regexp_replace(coalesce(new.facebook_id, ''), '[^0-9]', '', 'g'), ''),
    pg_catalog.lower(pg_catalog.regexp_replace(coalesce(new.facebook_link, ''), '[?#].*$', '')));
  if identity_key is null or identity_key = '' then return new; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('registration:' || identity_key, 0));
  if exists (select 1 from public.registration_requests r
    where r.status in ('pending', 'awaiting_payment') and r.id <> coalesce(new.id, 0)
      and coalesce(nullif(pg_catalog.regexp_replace(coalesce(r.facebook_id, ''), '[^0-9]', '', 'g'), ''),
        pg_catalog.lower(pg_catalog.regexp_replace(coalesce(r.facebook_link, ''), '[?#].*$', ''))) = identity_key) then
    raise exception 'Kiosk này đã có yêu cầu đăng ký đang chờ thanh toán.' using errcode = '23505';
  end if;
  return new;
end;
$function$;
revoke all on function private.prevent_duplicate_pending_registration() from public, anon, authenticated;

-- Explicit modern public writer. Legacy registration inserts its own rows and
-- therefore retains pending/Admin-review behavior.
create or replace function public.submit_registration_request(
  facebook_name_input text, phone_input text, facebook_id_input text, facebook_link_input text,
  address_input text, note_input text, category_id_input bigint, business_type_id_input bigint,
  months_input integer, discount_input numeric, discount_reason_input text
)
returns bigint language plpgsql security definer set search_path = '' as $function$
declare
  bt public.business_types%rowtype;
  request_id bigint;
  start_on date;
  end_on date;
  subtotal numeric;
  final_total numeric;
begin
  if length(trim(coalesce(facebook_name_input, ''))) < 1 then raise exception 'Tên Facebook là bắt buộc.'; end if;
  if length(trim(coalesce(phone_input, ''))) < 6 then raise exception 'Số điện thoại không hợp lệ.'; end if;
  if months_input is null or months_input < 1 or months_input > 60 then raise exception 'Số tháng phải từ 1 đến 60.'; end if;
  if coalesce(discount_input, 0) < 0 then raise exception 'Giảm giá không hợp lệ.'; end if;
  select * into bt from public.business_types where id = business_type_id_input and is_active = true;
  if not found then raise exception 'Loại hình kinh doanh không hoạt động.'; end if;
  if bt.category_id is distinct from category_id_input then raise exception 'Danh mục và loại hình kinh doanh không khớp.'; end if;
  subtotal := bt.price_per_month * months_input;
  final_total := subtotal - coalesce(discount_input, 0);
  if final_total < 0 then raise exception 'Giảm giá không được lớn hơn tạm tính.'; end if;
  if coalesce(discount_input, 0) > 0 and length(trim(coalesce(discount_reason_input, ''))) < 1 then
    raise exception 'Cần nhập lý do giảm giá.';
  end if;
  start_on := (pg_catalog.now() at time zone 'Europe/Berlin')::date;
  end_on := (start_on + pg_catalog.make_interval(months => months_input))::date;
  insert into public.registration_requests(facebook_name, facebook_id, facebook_link, phone, address, note,
    service_name, category_id, business_type_id, requested_start_date, requested_end_date,
    months, price_per_month, discount, discount_reason, total_amount, payment_method, status)
  values(trim(facebook_name_input), nullif(trim(coalesce(facebook_id_input, '')), ''),
    nullif(trim(coalesce(facebook_link_input, '')), ''), trim(phone_input),
    nullif(trim(coalesce(address_input, '')), ''), nullif(trim(coalesce(note_input, '')), ''),
    bt.name, bt.category_id, bt.id, start_on, end_on, months_input, bt.price_per_month,
    coalesce(discount_input, 0), nullif(trim(coalesce(discount_reason_input, '')), ''),
    final_total, 'transfer', 'awaiting_payment') returning id into request_id;
  return request_id;
end;
$function$;

-- Explicit public orchestrator with exact-match request reuse.
create or replace function public.submit_public_registration(
  customer_input jsonb, kiosks_input jsonb, bill_input jsonb default null
)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  kiosk_item jsonb; bt public.business_types%rowtype; request_id_value bigint;
  used_request_ids bigint[] := array[]::bigint[]; result_items jsonb := '[]'::jsonb;
  item_number integer := 0; months_value integer; discount_value numeric;
  start_on date; end_on date; total_value numeric;
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
  for kiosk_item in select value from jsonb_array_elements(kiosks_input) loop
    item_number := item_number + 1;
    if nullif(trim(kiosk_item->>'facebook_name'), '') is null
      or nullif(trim(kiosk_item->>'facebook_link'), '') is null then
      raise exception 'Kiosk số % cần tên Facebook và link Facebook.', item_number using errcode = '22023';
    end if;
    if nullif(trim(kiosk_item->>'facebook_id'), '') is not null
      and trim(kiosk_item->>'facebook_id') !~ '^[0-9]+$' then
      raise exception 'Facebook ID của kiosk số % chỉ được chứa chữ số.', item_number using errcode = '22023';
    end if;
    if nullif(pg_catalog.regexp_replace(coalesce(kiosk_item->>'facebook_id', ''), '[^0-9]', '', 'g'), '') is null
      or trim(kiosk_item->>'facebook_id') !~ '^[0-9]{5,30}$' then
      raise exception 'Kiosk số % cần Facebook ID dạng số hợp lệ.', item_number using errcode = '22023';
    end if;
    begin
      months_value := (kiosk_item->>'months')::integer;
      discount_value := coalesce((kiosk_item->>'discount')::numeric, 0);
      select * into bt from public.business_types
      where id = (kiosk_item->>'business_type_id')::bigint and is_active = true;
    exception when invalid_text_representation then
      raise exception 'Thông tin dịch vụ của kiosk số % không hợp lệ.', item_number using errcode = '22023';
    end;
    if not found then raise exception 'Dịch vụ của kiosk số % không hoạt động.', item_number using errcode = '22023'; end if;
    request_id_value := null;
    select r.id into request_id_value from public.registration_requests r
    where r.status = 'awaiting_payment' and r.id <> all(used_request_ids)
      and pg_catalog.regexp_replace(coalesce(r.phone, ''), '[^0-9+]', '', 'g')
        = pg_catalog.regexp_replace(customer_phone, '[^0-9+]', '', 'g')
      and r.facebook_id = trim(kiosk_item->>'facebook_id')
      and r.business_type_id = bt.id and r.months = months_value
      and r.total_amount = (bt.price_per_month * months_value) - discount_value
      and (r.payment_id is null or exists (select 1 from public.payments p
        where p.id = r.payment_id and p.payment_status = 'pending'))
    order by r.id desc limit 1 for update;
    if not found then
      request_id_value := public.submit_registration_request(
        kiosk_item->>'facebook_name', customer_phone, trim(kiosk_item->>'facebook_id'),
        kiosk_item->>'facebook_link', customer_input->>'address',
        coalesce(kiosk_item->>'note', customer_input->>'note'), bt.category_id, bt.id,
        months_value, discount_value, kiosk_item->>'discount_reason');
    end if;
    used_request_ids := array_append(used_request_ids, request_id_value);
    update public.registration_requests set status = 'awaiting_payment',
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('workflow', 'public_payos')
    where id = request_id_value;
    start_on := (pg_catalog.now() at time zone 'Europe/Berlin')::date;
    end_on := (start_on + pg_catalog.make_interval(months => months_value))::date;
    total_value := (bt.price_per_month * months_value) - discount_value;
    result_items := result_items || jsonb_build_array(jsonb_build_object(
      'request', jsonb_build_object('id', request_id_value, 'status', 'awaiting_payment'),
      'preview', jsonb_build_object('startDate', start_on, 'endDate', end_on, 'months', months_value,
        'pricePerMonth', bt.price_per_month, 'discount', discount_value, 'totalAmount', total_value),
      'businessType', jsonb_build_object('id', bt.id, 'name', bt.name)));
  end loop;
  return jsonb_build_object('customer', jsonb_build_object('facebook_name', customer_name,
    'facebook_link', nullif(trim(customer_input->>'facebook_link'), ''), 'phone', customer_phone),
    'kiosks', result_items, 'status', 'awaiting_payment',
    'bill_received', bill_input is not null and bill_input <> 'null'::jsonb);
end;
$function$;

revoke all on function public.submit_public_registration(jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.submit_public_registration(jsonb, jsonb, jsonb) to anon, authenticated;
revoke all on function public.submit_registration_request(text, text, text, text, text, text, bigint, bigint, integer, numeric, text)
  from public, anon, authenticated;
grant execute on function public.submit_registration_request(text, text, text, text, text, text, bigint, bigint, integer, numeric, text)
  to anon, authenticated;

-- Release only an unmaterialized active reservation after PayOS creation or
-- local recording fails. Paid/completed records can never match this guard.
create or replace function public.fail_registration_payos_order(
  payment_id_input bigint, order_code_input bigint, failure_stage_input text
)
returns boolean language plpgsql security definer set search_path = '' as $function$
declare changed integer;
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then
    raise exception 'Chỉ API server được cập nhật PayOS order đăng ký.' using errcode = '42501';
  end if;
  update public.payos_orders o set status = 'failed', active_slot = null,
    error = left(coalesce(failure_stage_input, 'PAYOS_FAILURE'), 100),
    processed_at = coalesce(o.processed_at, pg_catalog.now()), updated_at = pg_catalog.now()
  where o.payment_id = payment_id_input and o.order_code = order_code_input
    and o.purpose = 'crm_payment' and o.status = 'pending' and o.active_slot is true
    and o.checkout_url is null and exists (select 1 from public.payments p
      where p.id = o.payment_id and p.payment_status = 'pending');
  get diagnostics changed = row_count;
  return changed = 1;
end;
$function$;
revoke all on function public.fail_registration_payos_order(bigint, bigint, text) from public, anon, authenticated;
grant execute on function public.fail_registration_payos_order(bigint, bigint, text) to service_role;
