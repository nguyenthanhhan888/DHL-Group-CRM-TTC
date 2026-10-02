-- Final CRM fix: forward only; no existing record cleanup at migration time.
begin;
create or replace function private.expire_crm_checkout_slots(payment_id_input bigint default null)
returns integer language plpgsql security definer set search_path='' as $$
declare changed integer;
begin
  update public.payos_orders set status='expired',active_slot=null,updated_at=now()
  where purpose='crm_payment' and status='pending' and expires_at<=now()
    and (payment_id_input is null or payment_id=payment_id_input)
    and coalesce(provider_payload->'_status'->>'status','')<>'PAID';
  get diagnostics changed=row_count; return changed;
end $$;
revoke all on function private.expire_crm_checkout_slots(bigint) from public,anon,authenticated;
CREATE OR REPLACE FUNCTION private.materialize_registration_checkout_v3(request_ids_input bigint[], phone_input text, promotion_code_input text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  normalized_phone text := pg_catalog.regexp_replace(coalesce(phone_input, ''), '[^0-9+]', '', 'g');
  normalized_code text := nullif(pg_catalog.upper(pg_catalog.btrim(coalesce(promotion_code_input, ''))), '');
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
  evaluation_items jsonb := '[]'::jsonb;
  evaluation jsonb;
  batch_key text;
begin
  request_count := coalesce(pg_catalog.array_length(request_ids_input, 1), 0);
  if request_count < 1 or request_count > 20 then
    raise exception 'Lô đăng ký phải có từ 1 đến 20 Kiosk.' using errcode = '22023';
  end if;
  if normalized_phone = '' then
    raise exception 'Số điện thoại xác nhận không hợp lệ.' using errcode = '22023';
  end if;
  if (
    select pg_catalog.count(distinct value)
    from pg_catalog.unnest(request_ids_input) value
  ) <> request_count then
    raise exception 'Danh sách yêu cầu đăng ký bị trùng.' using errcode = '22023';
  end if;

  -- Serialize customer matching across different registration batches too.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('registration-phone:'||normalized_phone,0));
  batch_key := 'registration-checkout-v3:' || (
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
      and status <> 'awaiting_payment'
  ) then
    raise exception 'Lô đăng ký không còn ở trạng thái chờ thanh toán.' using errcode = '22023';
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
    if batch_record.status <> 'pending' then
      raise exception 'Lô đăng ký không còn chờ thanh toán.' using errcode = '22023';
    end if;
    select *
    into payment_record
    from public.payments
    where id = batch_record.payment_id
    for update;
    if not found or payment_record.payment_status <> 'pending' then
      raise exception 'Thanh toán đăng ký không còn chờ xử lý.' using errcode = '22023';
    end if;
    if batch_record.promotion_snapshot is null
      or batch_record.promotion_code is distinct from normalized_code then
      raise exception 'Mã ưu đãi của lô thanh toán đã được khóa.' using errcode = '22023';
    end if;
    return pg_catalog.jsonb_build_object(
      'batch', pg_catalog.to_jsonb(batch_record),
      'payment', pg_catalog.to_jsonb(payment_record),
      'promotion', batch_record.promotion_snapshot,
      'items', (
        select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'requestId', i.registration_request_id,
          'kioskId', i.kiosk_id,
          'name', k.facebook_name,
          'months', i.months,
          'paidMonths', i.paid_months,
          'bonusMonths', i.bonus_months,
          'effectiveMonths', i.effective_service_months,
          'pricePerMonth', i.price_per_month,
          'discount', i.discount,
          'totalAmount', i.total_amount,
          'promotionEligible', i.promotion_eligible
        ) order by i.id), '[]'::jsonb)
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
      select * into kiosk_record
      from public.kiosks
      where id = request_record.kiosk_id
      for update;
    else
      kiosk_record := null;
    end if;

    if kiosk_record.id is null then
      -- Cancel preserves the identity and old intent. Only an unpaid provisional
      -- Kiosk owned by this Customer may be reused; never hijack an active profile.
      select * into kiosk_record from public.kiosks
      where facebook_id = nullif(request_record.facebook_id, '') for update;
      if found then
        if kiosk_record.customer_id <> customer_record.id
          or kiosk_record.status not in ('inactive','pending')
          or kiosk_record.start_date is not null or kiosk_record.end_date is not null
          or exists(select 1 from public.payments p where p.kiosk_id=kiosk_record.id and p.payment_status='completed')
          or not exists(select 1 from public.registration_requests r where r.kiosk_id=kiosk_record.id and r.status='cancelled')
          or exists(select 1 from public.registration_requests r where r.kiosk_id=kiosk_record.id and r.status<>'cancelled')
        then raise exception 'Facebook ID đã có Kiosk. Vui lòng tra cứu hoặc gia hạn Kiosk hiện tại.'
          using errcode='23505', constraint='kiosks_facebook_id_unique', hint='kiosks_facebook_id_unique'; end if;
        update public.kiosks set status='pending',category_id=package_record.category_id,
          business_type_id=package_record.id,service_name=package_record.name
          where id=kiosk_record.id returning * into kiosk_record;
        update public.customers set archived_at=null,archived_reason=null,status='pending'
          where id=customer_record.id and archived_reason like 'cancelled_unpaid_registration:%';
      end if;
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
          select 1 from public.kiosks k
          where k.customer_id = customer_record.id and k.is_primary
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
        metadata = coalesce(metadata, '{}'::jsonb) || pg_catalog.jsonb_build_object(
          'materialized_for_checkout_v3_at', pg_catalog.now(),
          'promotion_code', normalized_code
        )
    where id = request_record.id;

    authoritative_total := authoritative_total + item_total;
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
    'Public registration checkout v3 batch #' || batch_record.id,
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

  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'itemId', i.id,
    'kioskId', i.kiosk_id,
    'months', i.months,
    'totalAmount', i.total_amount,
    'businessTypeId', i.business_type_id,
    'categoryId', bt.category_id
  ) order by i.id)
  into evaluation_items
  from public.registration_batch_items i
  join public.business_types bt on bt.id = i.business_type_id
  where i.batch_id = batch_record.id;

  evaluation := private.evaluate_registration_promotion(
    normalized_code,
    customer_record.id,
    evaluation_items
  );
  if not coalesce((evaluation->>'valid')::boolean, false) then
    raise exception '%', evaluation->>'message' using errcode = 'P0001';
  end if;

  update public.registration_batches
  set promotion_id = nullif(evaluation->>'promotionId', '')::bigint,
      promotion_code = evaluation->>'code',
      promotion_snapshot = evaluation,
      subtotal_before_discount = (evaluation->>'subtotal')::bigint,
      eligible_subtotal = (evaluation->>'eligibleSubtotal')::bigint,
      discount_amount = (evaluation->>'discountAmount')::bigint,
      total_amount = (evaluation->>'finalAmount')::bigint,
      updated_at = pg_catalog.now()
  where id = batch_record.id
  returning * into batch_record;

  perform pg_catalog.set_config('app.payment_workflow_action', 'edit', true);
  update public.payments
  set price_per_month = (evaluation->>'subtotal')::bigint,
      discount = (evaluation->>'discountAmount')::bigint,
      discount_reason = case when normalized_code is null then null else 'Promotion ' || normalized_code end,
      total_amount = (evaluation->>'finalAmount')::bigint
  where id = payment_record.id
  returning * into payment_record;

  update public.registration_batch_items i
  set promotion_eligible = coalesce((x.value->>'eligible')::boolean, false),
      bonus_months = coalesce((x.value->>'bonusMonths')::integer, 0),
      effective_service_months = coalesce((x.value->>'effectiveMonths')::integer, i.months)
  from pg_catalog.jsonb_array_elements(evaluation->'items') x
  where i.id = (x.value->>'itemId')::bigint;

  if (evaluation->>'discountAmount')::bigint > 0 then
    with eligible_items as (
      select i.id,
        i.total_amount,
        pg_catalog.floor(
          (evaluation->>'discountAmount')::numeric * i.total_amount
          / (evaluation->>'eligibleSubtotal')::numeric
        )::bigint as base_discount
      from public.registration_batch_items i
      where i.batch_id = batch_record.id and i.promotion_eligible
    ), ranked as (
      select e.*,
        pg_catalog.row_number() over (order by e.id) as allocation_rank,
        (evaluation->>'discountAmount')::bigint
          - pg_catalog.sum(e.base_discount) over () as remainder
      from eligible_items e
    )
    update public.registration_batch_items i
    set discount = r.base_discount + case when r.allocation_rank <= r.remainder then 1 else 0 end,
        total_amount = i.total_amount - (
          r.base_discount + case when r.allocation_rank <= r.remainder then 1 else 0 end
        )
    from ranked r
    where i.id = r.id;
  end if;

  if batch_record.total_amount is distinct from (
    select coalesce(pg_catalog.sum(i.total_amount), 0)
    from public.registration_batch_items i
    where i.batch_id = batch_record.id
  ) then
    raise exception 'Phân bổ ưu đãi không khớp tổng thanh toán.' using errcode = '23514';
  end if;

  update public.customers c
  set total_kiosks = (
    select pg_catalog.count(*) from public.kiosks k where k.customer_id = c.id
  )
  where c.id = customer_record.id;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'requestId', i.registration_request_id,
    'kioskId', i.kiosk_id,
    'name', k.facebook_name,
    'months', i.months,
    'paidMonths', i.paid_months,
    'bonusMonths', i.bonus_months,
    'effectiveMonths', i.effective_service_months,
    'pricePerMonth', i.price_per_month,
    'discount', i.discount,
    'totalAmount', i.total_amount,
    'promotionEligible', i.promotion_eligible
  ) order by i.id), '[]'::jsonb)
  into result_items
  from public.registration_batch_items i
  join public.kiosks k on k.id = i.kiosk_id
  where i.batch_id = batch_record.id;

  perform private.write_ttc_audit('Registration','registration_pending','registration_batches',batch_record.id::text,null,pg_catalog.jsonb_build_object('payment_id',payment_record.id,'kiosk_name',(select string_agg(k.facebook_name,', ' order by i.id) from public.registration_batch_items i join public.kiosks k on k.id=i.kiosk_id where i.batch_id=batch_record.id),'amount',payment_record.total_amount,'kiosk_count',request_count),'Đăng ký Kiosk – Chờ thanh toán');
  return pg_catalog.jsonb_build_object(
    'batch', pg_catalog.to_jsonb(batch_record),
    'payment', pg_catalog.to_jsonb(payment_record),
    'promotion', evaluation,
    'items', result_items,
    'reused', false
  );
end;
$function$;

CREATE OR REPLACE FUNCTION private.sync_registration_payment_intent()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.payment_id is not null and (tg_op = 'INSERT' or old.payment_id is distinct from new.payment_id) then
    update public.payments
    set registration_request_id = new.id,
        payment_intent_key = 'registration:' || new.id::text
    where id = new.payment_id
      and registration_batch_id is null
      and (registration_request_id is null or registration_request_id = new.id);
  end if;
  return new;
end;$function$;

CREATE OR REPLACE FUNCTION public.submit_public_registration(customer_input jsonb, kiosks_input jsonb, bill_input jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  -- Same ordering as checkout: phone first, then sorted Facebook identities.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'registration-phone:'||pg_catalog.regexp_replace(customer_phone,'[^0-9+]','','g'),0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('registration:'||identity,0))
    from (select distinct trim(value->>'facebook_id') identity from jsonb_array_elements(kiosks_input) order by 1) ids;
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

CREATE OR REPLACE FUNCTION public.fail_registration_payos_order(payment_id_input bigint, order_code_input bigint, failure_stage_input text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare changed integer;
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then
    raise exception 'Chỉ API server được cập nhật PayOS order đăng ký.' using errcode = '42501';
  end if;
  update public.payos_orders o set status = 'failed', active_slot = null,
    provider_payload = o.provider_payload || jsonb_build_object('failure_stage',left(coalesce(failure_stage_input, 'PAYOS_FAILURE'),100)),
    processed_at = coalesce(o.processed_at, pg_catalog.now()), updated_at = pg_catalog.now()
  where o.payment_id = payment_id_input and o.order_code = order_code_input
    and o.purpose = 'crm_payment' and o.status = 'pending' and o.active_slot is true
    and o.checkout_url is null and exists (select 1 from public.payments p
      where p.id = o.payment_id and p.payment_status = 'pending');
  get diagnostics changed = row_count;
  return changed = 1;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_complete_awaiting_registration(request_id_input bigint, note_input text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  request_record public.registration_requests%rowtype;
  batch_record public.registration_batches%rowtype;
  payment_record public.payments%rowtype;
  prepared jsonb;
  item_record record;
  completed_at timestamptz := pg_catalog.now();
  completed_on date := (pg_catalog.now() at time zone 'Asia/Ho_Chi_Minh')::date;
  calculated_end date;
  item_count integer := 0;
begin
  perform private.assert_registration_permission();
  perform private.assert_payment_permission();
  if nullif(btrim(note_input),'') is null then raise exception 'Cần ghi chú đối soát khoản tiền đã nhận.' using errcode='22023'; end if;

  select * into request_record
  from public.registration_requests
  where id = request_id_input
  for update;
  if not found then
    raise exception 'Không tìm thấy hồ sơ đăng ký.' using errcode = 'P0002';
  end if;

  if request_record.status = 'approved' and request_record.payment_id is not null
    and exists (
      select 1 from public.payments p
      where p.id = request_record.payment_id and p.payment_status = 'completed'
    ) then
    return pg_catalog.jsonb_build_object(
      'already_completed', true,
      'request_id', request_record.id,
      'payment_id', request_record.payment_id,
      'batch_id', request_record.registration_batch_id
    );
  end if;
  if request_record.status <> 'awaiting_payment' then
    raise exception 'Hồ sơ không còn chờ thanh toán.' using errcode = '22023';
  end if;

  if request_record.registration_batch_id is null then
    prepared := private.materialize_registration_checkout_v3(
      array[request_record.id], request_record.phone, null
    );
    request_record.registration_batch_id := (prepared->'batch'->>'id')::bigint;
  end if;

  select * into batch_record
  from public.registration_batches
  where id = request_record.registration_batch_id
  for update;
  select * into payment_record
  from public.payments
  where id = batch_record.payment_id
  for update;

  if batch_record.status <> 'pending' or payment_record.payment_status <> 'pending' then
    raise exception 'Lô hoặc thanh toán không còn chờ xử lý.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.payos_orders o
    where o.payment_id = payment_record.id and o.status = 'paid'
  ) then
    raise exception 'PayOS đã ghi nhận thanh toán; không thể xác nhận ngoài PayOS.' using errcode = '23505';
  end if;

  perform 1
  from public.registration_batch_items i
  join public.kiosks k on k.id = i.kiosk_id
  join public.registration_requests r on r.id = i.registration_request_id
  where i.batch_id = batch_record.id
  order by i.id
  for update of i, k, r;

  update public.payos_orders
  set status = 'cancelled',
      active_slot = false,
      processed_at = coalesce(processed_at, completed_at),
      updated_at = completed_at,
      provider_payload = coalesce(provider_payload, '{}'::jsonb)
        || pg_catalog.jsonb_build_object('admin_logical_cancel', true)
  where payment_id = payment_record.id and status = 'pending';

  for item_record in
    select i.*
    from public.registration_batch_items i
    where i.batch_id = batch_record.id
    order by i.id
  loop
    calculated_end := (
      completed_on
      + pg_catalog.make_interval(months => item_record.effective_service_months)
      - interval '1 day'
    )::date;
    update public.registration_batch_items
    set start_date = completed_on, end_date = calculated_end
    where id = item_record.id;
    update public.kiosks
    set status = 'active', start_date = completed_on, end_date = calculated_end
    where id = item_record.kiosk_id;
    update public.registration_requests
    set status = 'approved',
        requested_start_date = completed_on,
        requested_end_date = calculated_end,
        reviewed_at = completed_at,
        reviewed_by = auth.uid(),
        metadata = coalesce(metadata, '{}'::jsonb) || pg_catalog.jsonb_build_object(
          'completed_source', 'admin_external',
          'completed_at', completed_at
        )
    where id = item_record.registration_request_id;
    item_count := item_count + 1;
  end loop;

  if item_count < 1 then
    raise exception 'Lô đăng ký không có Kiosk.' using errcode = '23514';
  end if;

  perform pg_catalog.set_config('app.payment_workflow_action', 'confirm', true);
  update public.payments
  set payment_method = 'external',
      payment_status = 'completed',
      confirmed_by = auth.uid()::text,
      confirmed_at = completed_at,
      note = pg_catalog.concat_ws(E'\n', nullif(note, ''),
        'Admin external payment: ' || coalesce(nullif(pg_catalog.btrim(note_input), ''), 'confirmed'))
  where id = payment_record.id
  returning * into payment_record;

  update public.registration_batches
  set status = 'approved', approved_at = completed_at, updated_at = completed_at
  where id = batch_record.id
  returning * into batch_record;

  update public.customers
  set status = case when pg_catalog.lower(coalesce(status, '')) = 'pending' then 'active' else status end,
      total_kiosks = (
        select pg_catalog.count(*) from public.kiosks k where k.customer_id = batch_record.customer_id
      )
  where id = batch_record.customer_id;

  perform private.write_ttc_audit(
    'Registration', 'manual_accept', 'registration_batches', batch_record.id::text,
    null,
    pg_catalog.jsonb_build_object(
      'request_id', request_id_input,
      'payment_id', payment_record.id,
      'amount', payment_record.total_amount,
      'payment_method', 'external',
      'kiosk_count', item_count
    ),
    coalesce(nullif(pg_catalog.btrim(note_input), ''), 'Admin confirmed external payment')
  );

  return pg_catalog.jsonb_build_object(
    'already_completed', false,
    'request_id', request_id_input,
    'batch_id', batch_record.id,
    'payment_id', payment_record.id,
    'amount', payment_record.total_amount,
    'kiosk_count', item_count
  );
end;
$function$;

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
  actor := private.assert_registration_permission();

  select *
  into request_record
  from public.registration_requests
  where id = request_id_input
  for update;

  if not found then
    raise exception 'Không tìm thấy đơn đăng ký.';
  end if;
  if request_record.registration_batch_id is not null or request_record.metadata->>'workflow'='public_payos' then
    raise exception 'Hồ sơ PayOS phải chờ xác nhận thanh toán.' using errcode='22023';
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

CREATE OR REPLACE FUNCTION public.admin_list_registration_requests(status_input text)
 RETURNS jsonb
 LANGUAGE plpgsql
 VOLATILE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  normalized_status text := nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(status_input, ''))), '');
begin
  perform private.assert_registration_permission();
  perform private.expire_crm_checkout_slots();
  if normalized_status is not null
    and normalized_status not in ('awaiting_payment', 'pending', 'approved', 'terminal') then
    raise exception 'Bộ lọc trạng thái không hợp lệ.' using errcode = '22023';
  end if;

  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', r.id,
      'facebook_name', r.facebook_name,
      'facebook_id', r.facebook_id,
      'facebook_link', r.facebook_link,
      'phone', r.phone,
      'service_name', r.service_name,
      'category_name', c.name,
      'business_type_name', bt.name,
      'months', r.months,
      'requested_start_date', r.requested_start_date,
      'requested_end_date', r.requested_end_date,
      'total_amount', coalesce(bi.total_amount, r.total_amount),
      'batch_total_amount', b.total_amount,
      'batch_item_count', case when b.id is null then null else (
        select pg_catalog.count(*)
        from public.registration_batch_items batch_item_count
        where batch_item_count.batch_id = b.id
      ) end,
      'submitted_at', r.submitted_at,
      'reviewed_at', r.reviewed_at,
      'rejection_reason', r.rejection_reason,
      'status', r.status,
      'metadata', r.metadata,
      'customer_id', r.customer_id,
      'kiosk_id', r.kiosk_id,
      'registration_batch_id', r.registration_batch_id,
      'batch_status', b.status,
      'payment_id', r.payment_id,
      'payment_status', p.payment_status,
      'payment_method', p.payment_method,
      'payos_order_status', po.status,
      'payos_has_checkout_url', nullif(pg_catalog.btrim(coalesce(po.checkout_url, p.payos_checkout_url, '')), '') is not null,
      'payos_expires_at', coalesce(po.expires_at, p.payos_expire_at),
      'payos_state', case
        when p.payment_status = 'completed' then 'completed'
        when r.registration_batch_id is null and coalesce(r.metadata->>'workflow','')<>'public_payos'
          and r.status in ('pending','approved') and po.id is null then 'manual_pending'
        when po.status = 'failed' or p.payos_checkout_state = 'failed' then 'create_failed'
        when po.status = 'cancelled' then 'cancelled'
        when coalesce(po.expires_at, p.payos_expire_at) is not null
          and coalesce(po.expires_at, p.payos_expire_at) <= pg_catalog.now() then 'expired'
        when po.status = 'pending'
          and nullif(pg_catalog.btrim(coalesce(po.checkout_url, p.payos_checkout_url, '')), '') is not null then 'awaiting_customer'
        when r.payment_id is null then 'not_created'
        else 'preparing'
      end
    ) order by r.submitted_at desc, r.id desc)
    from public.registration_requests r
    left join public.categories c on c.id = r.category_id
    left join public.business_types bt on bt.id = r.business_type_id
    left join public.registration_batches b on b.id = r.registration_batch_id
    left join public.registration_batch_items bi
      on bi.batch_id = b.id and bi.registration_request_id = r.id
    left join public.payments p on p.id = r.payment_id
    left join lateral (
      select o.* from public.payos_orders o
      where o.payment_id = p.id
      order by o.created_at desc, o.id desc
      limit 1
    ) po on true
    where normalized_status is null
      or r.status = normalized_status
      or (normalized_status='awaiting_payment' and r.status='approved' and p.payment_status='pending')
      or (normalized_status = 'terminal' and r.status in ('rejected', 'cancelled'))
  ), '[]'::jsonb);
end;
$function$;

do $migration$
declare original text; changed text;
begin
  select pg_get_functiondef('private.reserve_crm_payos_order(bigint,bigint,numeric,text,text,text,text,jsonb)'::regprocedure) into original;
  changed:=replace(original, 'using errcode=''23505''; end if;', 'using errcode=''23505'', constraint=''payos_orders_one_active_payment_uidx'', hint=''payos_orders_one_active_payment_uidx''; end if;');
  if changed=original then raise exception 'Reservation guard did not match'; end if;
  execute changed;
end $migration$;

-- Identity comparison removes tracking and treats numeric profile URLs consistently.
create or replace function private.crm_facebook_profile_key(value text)
returns text language sql immutable set search_path='' as $$
 select case
   when lower(btrim(value)) ~ '^https?://(www[.]|m[.]|mbasic[.]|web[.])?facebook[.]com/profile[.]php[?].*id=[0-9]+'
     then 'facebook.com/'||substring(value from '[?&]id=([0-9]+)')
   else nullif(regexp_replace(regexp_replace(regexp_replace(lower(btrim(value)),
     '^https?://(www[.]|m[.]|mbasic[.]|web[.])?',''),'[?#].*$',''),'/$',''),'') end
$$;
revoke all on function private.crm_facebook_profile_key(text) from public,anon,authenticated;

-- Manual existing-Customer registration. No account creation or provider call.
create or replace function public.submit_existing_customer_kiosk(customer_id_input bigint,kiosk_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.customers%rowtype; k public.kiosks%rowtype; r public.registration_requests%rowtype;
  p public.payments%rowtype; bt public.business_types%rowtype; request_id bigint;
  identity text:=nullif(btrim(kiosk_input->>'facebook_id'),'');
  months_value integer:=(kiosk_input->>'months')::integer;
  discount_value numeric:=coalesce((kiosk_input->>'discount')::numeric,0);
begin
  if not (public.has_user_permission('customers') or public.has_user_permission('customer-detail'))
    or not (public.has_user_permission('kiosks') or public.has_user_permission('kiosk-detail')) then
    raise exception 'Cần quyền Khách hàng và Kiosk để đăng ký thêm Kiosk.' using errcode='42501';
  end if;
  if identity is null or identity !~ '^[0-9]{5,30}$' or nullif(btrim(kiosk_input->>'facebook_link'),'') is null then
    raise exception 'Facebook ID và link Facebook hợp lệ là bắt buộc.' using errcode='22023'; end if;
  select * into c from public.customers where id=customer_id_input for update;
  if not found or c.archived_at is not null then raise exception 'Khách hàng không tồn tại hoặc đã lưu trữ.' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('registration:'||identity,0));
  if exists(select 1 from public.kiosks where facebook_id=identity
    or private.crm_facebook_profile_key(facebook_link)=private.crm_facebook_profile_key(kiosk_input->>'facebook_link')) then
    raise exception 'Facebook ID/profile đã có Kiosk. Hãy sử dụng Kiosk hiện tại.' using errcode='23505',constraint='kiosks_facebook_id_unique', hint='kiosks_facebook_id_unique'; end if;
  select * into bt from public.business_types where id=(kiosk_input->>'business_type_id')::bigint and is_active for share;
  if not found then raise exception 'Dịch vụ không hoạt động.' using errcode='22023'; end if;
  request_id:=public.submit_registration_request(kiosk_input->>'facebook_name',c.phone,identity,
    kiosk_input->>'facebook_link',c.address,kiosk_input->>'note',bt.category_id,bt.id,months_value,discount_value,kiosk_input->>'discount_reason');
  insert into public.kiosks(customer_id,facebook_name,facebook_id,facebook_link,facebook_group_link,
    category_id,business_type_id,service_name,status,auto_approve,is_primary,note)
  values(c.id,btrim(kiosk_input->>'facebook_name'),identity,kiosk_input->>'facebook_link',kiosk_input->>'facebook_group_link',
    bt.category_id,bt.id,bt.name,'pending',false,not exists(select 1 from public.kiosks where customer_id=c.id and is_primary),kiosk_input->>'note')
  returning * into k;
  insert into public.payments(customer_id,kiosk_id,months,price_per_month,discount,discount_reason,total_amount,payment_method,payment_status,registration_request_id,payment_intent_key,note)
  values(c.id,k.id,months_value,bt.price_per_month,discount_value,nullif(btrim(kiosk_input->>'discount_reason'),''),
    bt.price_per_month*months_value-discount_value,'transfer','pending',request_id,'registration:'||request_id,kiosk_input->>'note') returning * into p;
  update public.registration_requests set customer_id=c.id,kiosk_id=k.id,payment_id=p.id,status='pending',
    requested_start_date=null,requested_end_date=null,
    metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('workflow','manual_existing_customer')
    where id=request_id returning * into r;
  update public.customers set total_kiosks=(select count(*) from public.kiosks where customer_id=c.id) where id=c.id;
  return jsonb_build_object('customer',to_jsonb(c),'kiosk',to_jsonb(k),'request',to_jsonb(r),'payment',to_jsonb(p));
end $$;
revoke all on function public.submit_existing_customer_kiosk(bigint,jsonb) from public,anon;
grant execute on function public.submit_existing_customer_kiosk(bigint,jsonb) to authenticated;

create or replace function public.get_registration_actionable_summary()
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare result jsonb;
begin
  if not public.has_user_permission('registration-requests') and not public.has_user_permission('notifications') then
    raise exception 'Không có quyền xem hồ sơ cần xử lý.' using errcode='42501'; end if;
  perform private.expire_crm_checkout_slots();
  with states as (
    select r.*,
      (r.status='pending' and r.registration_batch_id is null and coalesce(r.metadata->>'workflow','')<>'public_payos') manual_review,
      exists(select 1 from public.payos_orders o where o.payment_id=r.payment_id and o.reconciliation_required) needs_review
    from public.registration_requests r where r.status in ('pending','awaiting_payment')
  )
  select jsonb_build_object(
    'pendingReviewCount',count(*) filter(where manual_review),
    'awaitingPaymentCount',count(*) filter(where status='awaiting_payment'),
    'reconciliationCount',(select count(*) from public.payos_orders where reconciliation_required),
    'registrationReconciliationCount',count(*) filter(where needs_review and not manual_review),
    'actionableRegistrationCount',count(*) filter(where manual_review or needs_review),
    'pendingItems',coalesce((select jsonb_agg(to_jsonb(x)) from (select id,facebook_name,submitted_at,metadata from states where manual_review order by submitted_at desc limit 10) x),'[]'::jsonb),
    'awaitingPaymentItems','[]'::jsonb
  ) into result from states;
  return result;
end $$;
revoke all on function public.get_registration_actionable_summary() from public,anon;
grant execute on function public.get_registration_actionable_summary() to authenticated;

-- Read-only candidate lookup uses current permissions and normalized exact identity.
create or replace function public.find_customer_duplicates(phone_input text,facebook_id_input text,facebook_link_input text,name_input text,exclude_id_input bigint default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not public.has_user_permission('customers') and not public.has_user_permission('customer-detail') then
    raise exception 'Không có quyền Khách hàng.' using errcode='42501'; end if;
  return coalesce((select jsonb_agg(to_jsonb(x)) from (
    select c.id,c.facebook_name,c.phone,c.facebook_id,c.facebook_link,
      case when regexp_replace(c.phone,'[^0-9+]','','g')=nullif(regexp_replace(phone_input,'[^0-9+]','','g'),'')
        or c.facebook_id=nullif(btrim(facebook_id_input),'')
        or private.crm_facebook_profile_key(c.facebook_link)=private.crm_facebook_profile_key(facebook_link_input)
        then 'exact' else 'similar' end as match_type
    from public.customers c
    where (exclude_id_input is null or c.id<>exclude_id_input) and (
      regexp_replace(c.phone,'[^0-9+]','','g')=nullif(regexp_replace(phone_input,'[^0-9+]','','g'),'')
      or c.facebook_id=nullif(btrim(facebook_id_input),'')
      or private.crm_facebook_profile_key(c.facebook_link)=private.crm_facebook_profile_key(facebook_link_input)
      or lower(btrim(c.facebook_name))=nullif(lower(btrim(name_input)),''))
    order by match_type,c.id limit 10
  ) x),'[]'::jsonb);
end $$;
revoke all on function public.find_customer_duplicates(text,text,text,text,bigint) from public,anon;
grant execute on function public.find_customer_duplicates(text,text,text,text,bigint) to authenticated;
commit;
