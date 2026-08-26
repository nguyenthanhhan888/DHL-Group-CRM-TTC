-- Complete the public registration checkout state machine without changing
-- historical rows. This migration is forward-only and intentionally uses
-- explicit function bodies (no catalog text rewriting or overloads).

alter table public.registration_requests
  drop constraint if exists registration_requests_status_check;
alter table public.registration_requests
  add constraint registration_requests_status_check
  check (status in ('awaiting_payment', 'pending', 'approved', 'rejected', 'cancelled'));

-- A provisional public intent must not block a separate Admin-review flow.
-- Public intents still serialize against both public intents and real pending
-- review requests for the same Facebook identity.
create or replace function private.prevent_duplicate_pending_registration()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  identity_key text;
begin
  identity_key := coalesce(
    nullif(pg_catalog.regexp_replace(coalesce(new.facebook_id, ''), '[^0-9]', '', 'g'), ''),
    pg_catalog.lower(pg_catalog.regexp_replace(coalesce(new.facebook_link, ''), '[?#].*$', ''))
  );
  if identity_key is null or identity_key = '' then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('registration:' || identity_key, 0)
  );

  if exists (
    select 1
    from public.registration_requests r
    where r.id <> coalesce(new.id, 0)
      and new.status in ('pending', 'awaiting_payment')
      and (
        r.status = 'pending'
        or (new.status = 'awaiting_payment' and r.status = 'awaiting_payment')
      )
      and coalesce(
        nullif(pg_catalog.regexp_replace(coalesce(r.facebook_id, ''), '[^0-9]', '', 'g'), ''),
        pg_catalog.lower(pg_catalog.regexp_replace(coalesce(r.facebook_link, ''), '[?#].*$', ''))
      ) = identity_key
  ) then
    raise exception 'Kiosk này đã có yêu cầu đăng ký đang xử lý.' using errcode = '23505';
  end if;
  return new;
end;
$function$;

revoke all on function private.prevent_duplicate_pending_registration()
  from public, anon, authenticated, service_role;

-- Legacy/Additional may ignore an unmaterialized public intent, but it must
-- not finalize over a live materialized checkout. Admin must first cancel the
-- public checkout so its batch/payment/PayOS history is closed coherently.
create or replace function private.guard_legacy_approval_against_live_public_checkout()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.status = 'approved'
    and old.status is distinct from new.status
    and new.metadata->>'request_type' = 'legacy'
    and exists (
      select 1
      from public.registration_requests provisional
      where provisional.id <> new.id
        and provisional.status = 'awaiting_payment'
        and provisional.registration_batch_id is not null
        and provisional.metadata->>'workflow' = 'public_payos'
        and (
          (new.kiosk_id is not null and provisional.kiosk_id = new.kiosk_id)
          or coalesce(
            nullif(pg_catalog.regexp_replace(coalesce(provisional.facebook_id, ''), '[^0-9]', '', 'g'), ''),
            pg_catalog.lower(pg_catalog.regexp_replace(coalesce(provisional.facebook_link, ''), '[?#].*$', ''))
          ) = coalesce(
            nullif(pg_catalog.regexp_replace(coalesce(new.facebook_id, ''), '[^0-9]', '', 'g'), ''),
            pg_catalog.lower(pg_catalog.regexp_replace(coalesce(new.facebook_link, ''), '[?#].*$', ''))
          )
        )
    )
  then
    raise exception 'Hãy hủy hồ sơ PayOS đang chờ trước khi duyệt luồng Legacy/Bổ sung.'
      using errcode = '23505';
  end if;
  return new;
end;
$function$;

revoke all on function private.guard_legacy_approval_against_live_public_checkout()
  from public, anon, authenticated, service_role;

drop trigger if exists guard_legacy_approval_against_live_public_checkout_trigger
  on public.registration_requests;
create trigger guard_legacy_approval_against_live_public_checkout_trigger
before update of status on public.registration_requests
for each row execute function private.guard_legacy_approval_against_live_public_checkout();

-- Once the public checkout is cancelled, the stable Legacy approval RPC may
-- reuse its same-customer provisional Kiosk. Finish that explicit handoff so
-- the completed Legacy payment cannot leave the reused Kiosk pending.
create or replace function private.finalize_cancelled_public_kiosk_from_legacy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.status = 'approved'
    and old.status is distinct from new.status
    and new.metadata->>'request_type' = 'legacy'
    and new.customer_id is not null
    and new.kiosk_id is not null
    and (
      coalesce(new.total_amount, 0) <= 0
      or exists (
        select 1
        from public.payments completed_payment
        where completed_payment.id = new.payment_id
          and completed_payment.customer_id = new.customer_id
          and completed_payment.kiosk_id = new.kiosk_id
          and completed_payment.payment_status = 'completed'
      )
    )
    and exists (
      select 1
      from public.registration_requests cancelled_public
      where cancelled_public.id <> new.id
        and cancelled_public.kiosk_id = new.kiosk_id
        and cancelled_public.status = 'cancelled'
        and cancelled_public.metadata->>'workflow' = 'public_payos'
    )
  then
    update public.kiosks
    set category_id = new.category_id,
        business_type_id = new.business_type_id,
        service_name = new.service_name,
        start_date = new.requested_start_date,
        end_date = new.requested_end_date,
        status = case
          when new.requested_end_date < (pg_catalog.now() at time zone 'Asia/Ho_Chi_Minh')::date
            then 'expired'
          else 'active'
        end
    where id = new.kiosk_id
      and customer_id = new.customer_id
      and status = 'pending';
  end if;
  return new;
end;
$function$;

revoke all on function private.finalize_cancelled_public_kiosk_from_legacy()
  from public, anon, authenticated, service_role;

drop trigger if exists finalize_cancelled_public_kiosk_from_legacy_trigger
  on public.registration_requests;
create trigger finalize_cancelled_public_kiosk_from_legacy_trigger
after update of status on public.registration_requests
for each row execute function private.finalize_cancelled_public_kiosk_from_legacy();

-- Private base: the known-good pre-promotion materialization path plus one
-- optional promotion evaluation in the same transaction.
create or replace function private.materialize_registration_checkout_v3(
  request_ids_input bigint[],
  phone_input text,
  promotion_code_input text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
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

  return pg_catalog.jsonb_build_object(
    'batch', pg_catalog.to_jsonb(batch_record),
    'payment', pg_catalog.to_jsonb(payment_record),
    'promotion', evaluation,
    'items', result_items,
    'reused', false
  );
end;
$function$;

revoke all on function private.materialize_registration_checkout_v3(bigint[], text, text)
  from public, anon, authenticated, service_role;

create function public.prepare_registration_checkout_v3(
  request_ids_input bigint[],
  phone_input text,
  promotion_code_input text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then
    raise exception 'Chỉ API server được chuẩn bị thanh toán đăng ký.' using errcode = '42501';
  end if;
  return private.materialize_registration_checkout_v3(
    request_ids_input,
    phone_input,
    promotion_code_input
  );
end;
$function$;

revoke all on function public.prepare_registration_checkout_v3(bigint[], text, text)
  from public, anon, authenticated;
grant execute on function public.prepare_registration_checkout_v3(bigint[], text, text)
  to service_role;

-- Retire old public checkout entry points from PostgREST execution. The
-- functions remain for historical migration integrity, but v3 is the only
-- executable current checkout RPC.
revoke all on function public.prepare_registration_payment_v2(bigint[], text)
  from public, anon, authenticated, service_role;
revoke all on function public.prepare_registration_batch_for_payos(bigint[], text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.prepare_registration_payment_for_payos(bigint, text)
  from public, anon, authenticated, service_role;

create function public.admin_complete_awaiting_registration(
  request_id_input bigint,
  note_input text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
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
  if auth.uid() is null or not exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid()
      and pg_catalog.lower(ur.role) = 'admin'
      and ur.is_active
  ) then
    raise exception 'Bạn không có quyền hoàn tất thanh toán ngoài PayOS.' using errcode = '42501';
  end if;

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

revoke all on function public.admin_complete_awaiting_registration(bigint, text)
  from public, anon, authenticated;
grant execute on function public.admin_complete_awaiting_registration(bigint, text)
  to authenticated;

create function public.admin_cancel_awaiting_registration(
  request_id_input bigint,
  reason_input text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  request_record public.registration_requests%rowtype;
  batch_record public.registration_batches%rowtype;
  payment_record public.payments%rowtype;
  cancelled_at timestamptz := pg_catalog.now();
  affected_requests bigint[];
begin
  if auth.uid() is null or not exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid()
      and pg_catalog.lower(ur.role) = 'admin'
      and ur.is_active
  ) then
    raise exception 'Bạn không có quyền hủy hồ sơ chờ thanh toán.' using errcode = '42501';
  end if;
  if nullif(pg_catalog.btrim(reason_input), '') is null then
    raise exception 'Cần nhập lý do hủy.' using errcode = '22023';
  end if;

  select * into request_record
  from public.registration_requests
  where id = request_id_input
  for update;
  if not found then
    raise exception 'Không tìm thấy hồ sơ đăng ký.' using errcode = 'P0002';
  end if;
  if request_record.status = 'cancelled' then
    return pg_catalog.jsonb_build_object('already_cancelled', true, 'request_id', request_record.id);
  end if;
  if request_record.status <> 'awaiting_payment' then
    raise exception 'Chỉ hồ sơ chờ thanh toán mới có thể hủy.' using errcode = '22023';
  end if;

  if request_record.registration_batch_id is not null then
    select * into batch_record
    from public.registration_batches
    where id = request_record.registration_batch_id
    for update;
    select * into payment_record
    from public.payments
    where id = batch_record.payment_id
    for update;

    if payment_record.payment_status = 'completed'
      or exists (
        select 1 from public.payos_orders o
        where o.payment_id = payment_record.id and o.status = 'paid'
      )
      or exists (
        select 1
        from public.registration_batch_items i
        join public.kiosks k on k.id = i.kiosk_id
        where i.batch_id = batch_record.id and k.status = 'active'
      ) then
      raise exception 'Hồ sơ đã có thanh toán hoàn tất hoặc Kiosk hoạt động.' using errcode = '23505';
    end if;

    select pg_catalog.array_agg(i.registration_request_id order by i.registration_request_id)
    into affected_requests
    from public.registration_batch_items i
    where i.batch_id = batch_record.id;

    update public.payos_orders
    set status = 'cancelled', active_slot = false,
        processed_at = coalesce(processed_at, cancelled_at), updated_at = cancelled_at,
        provider_payload = coalesce(provider_payload, '{}'::jsonb)
          || pg_catalog.jsonb_build_object('admin_logical_cancel', true)
    where payment_id = payment_record.id and status = 'pending';

    if payment_record.payment_status = 'pending' then
      perform pg_catalog.set_config('app.payment_workflow_action', 'cancel', true);
      update public.payments
      set payment_status = 'cancelled',
          note = pg_catalog.concat_ws(E'\n', nullif(note, ''), 'Admin cancelled: ' || pg_catalog.btrim(reason_input))
      where id = payment_record.id;
    end if;
    update public.registration_batches
    set status = 'cancelled', updated_at = cancelled_at
    where id = batch_record.id;
  else
    affected_requests := array[request_record.id];
  end if;

  update public.registration_requests
  set status = 'cancelled',
      reviewed_at = cancelled_at,
      reviewed_by = auth.uid(),
      rejection_reason = pg_catalog.btrim(reason_input),
      metadata = coalesce(metadata, '{}'::jsonb) || pg_catalog.jsonb_build_object(
        'cancelled_source', 'admin', 'cancelled_at', cancelled_at
      )
  where id = any(affected_requests);

  perform private.write_ttc_audit(
    'Registration', 'admin_cancel', 'registration_requests', request_id_input::text,
    pg_catalog.to_jsonb(request_record),
    pg_catalog.jsonb_build_object(
      'status', 'cancelled',
      'batch_id', request_record.registration_batch_id,
      'affected_request_ids', affected_requests
    ),
    pg_catalog.btrim(reason_input)
  );

  return pg_catalog.jsonb_build_object(
    'already_cancelled', false,
    'request_id', request_id_input,
    'batch_id', request_record.registration_batch_id,
    'affected_request_ids', affected_requests
  );
end;
$function$;

revoke all on function public.admin_cancel_awaiting_registration(bigint, text)
  from public, anon, authenticated;
grant execute on function public.admin_cancel_awaiting_registration(bigint, text)
  to authenticated;

create function public.get_registration_operations_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null or not exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid()
      and pg_catalog.lower(ur.role) = 'admin'
      and ur.is_active
  ) then
    raise exception 'Bạn không có quyền xem tổng hợp đăng ký.' using errcode = '42501';
  end if;
  return pg_catalog.jsonb_build_object(
    'pendingPayments', (select pg_catalog.count(*) from public.payments p where p.payment_status = 'pending'),
    'awaitingPaymentRequests', (select pg_catalog.count(*) from public.registration_requests r where r.status = 'awaiting_payment'),
    'pendingKiosks', (select pg_catalog.count(*) from public.kiosks k where k.status = 'pending'),
    'pendingReviewRequests', (select pg_catalog.count(*) from public.registration_requests r where r.status = 'pending')
  );
end;
$function$;

revoke all on function public.get_registration_operations_summary()
  from public, anon, authenticated;
grant execute on function public.get_registration_operations_summary()
  to authenticated;

create function public.admin_list_registration_requests(status_input text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  normalized_status text := nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(status_input, ''))), '');
begin
  if auth.uid() is null or not exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid()
      and pg_catalog.lower(ur.role) = 'admin'
      and ur.is_active
  ) then
    raise exception 'Bạn không có quyền xem hồ sơ đăng ký.' using errcode = '42501';
  end if;
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
      or (normalized_status = 'terminal' and r.status in ('rejected', 'cancelled'))
  ), '[]'::jsonb);
end;
$function$;

revoke all on function public.admin_list_registration_requests(text)
  from public, anon, authenticated;
grant execute on function public.admin_list_registration_requests(text)
  to authenticated;
