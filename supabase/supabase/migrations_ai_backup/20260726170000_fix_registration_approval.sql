alter table public.user_roles
  drop constraint if exists user_roles_user_id_fkey;
alter table public.user_roles
  add constraint user_roles_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete restrict;

-- Retire legacy aggregate/workflow triggers before they can run beside the
-- authoritative Task 03 and Task 06 triggers.
drop trigger if exists on_kiosk_change on public.kiosks;
drop trigger if exists trg_payment_success on public.payments;

alter table public.registration_requests
  add column if not exists payment_id bigint
  references public.payments(id) on delete restrict;

create index if not exists registration_requests_payment_idx
  on public.registration_requests(payment_id);
create index if not exists registration_requests_customer_idx
  on public.registration_requests(customer_id);
create index if not exists registration_requests_kiosk_idx
  on public.registration_requests(kiosk_id);
create index if not exists registration_requests_category_idx
  on public.registration_requests(category_id);
create index if not exists registration_requests_business_type_idx
  on public.registration_requests(business_type_id);
create index if not exists registration_requests_reviewed_by_idx
  on public.registration_requests(reviewed_by);

create or replace function private.link_registration_request_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.payment_id is null and new.kiosk_id is not null and new.customer_id is not null then
    select p.id
    into new.payment_id
    from public.payments p
    where p.kiosk_id = new.kiosk_id
      and p.customer_id = new.customer_id
      and lower(p.payment_status) = 'pending'
      and p.transaction_type = 'standard'
    order by p.created_at desc, p.id desc
    limit 1;
  end if;
  return new;
end;
$function$;

drop trigger if exists link_registration_request_payment_trigger
  on public.registration_requests;
create trigger link_registration_request_payment_trigger
before insert on public.registration_requests
for each row execute function private.link_registration_request_payment();

create or replace function private.registration_request_payment(
  request_record public.registration_requests
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $function$
declare
  resolved_payment_id bigint;
  candidate_count integer;
begin
  if request_record.payment_id is not null then
    return request_record.payment_id;
  end if;

  select count(*), min(p.id)
  into candidate_count, resolved_payment_id
  from public.payments p
  where p.kiosk_id = request_record.kiosk_id
    and p.customer_id = request_record.customer_id
    and lower(p.payment_status) = 'pending'
    and p.transaction_type = 'standard'
    and (request_record.months is null or p.months = request_record.months)
    and (request_record.total_amount is null or p.total_amount = request_record.total_amount);

  if candidate_count <> 1 then
    raise exception 'Không xác định được duy nhất thanh toán Pending của đơn đăng ký.'
      using errcode = 'P0001';
  end if;
  return resolved_payment_id;
end;
$function$;

create or replace function public.submit_existing_customer_kiosk(
  customer_id_input bigint,
  kiosk_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor public.user_roles%rowtype;
  customer_record public.customers%rowtype;
  kiosk_record public.kiosks%rowtype;
  payment_record public.payments%rowtype;
  business_type_record public.business_types%rowtype;
  facebook_id_value text;
  facebook_name_value text;
  group_link_value text;
  months_value integer;
  discount_value numeric;
  total_value numeric;
  discount_reason_value text;
begin
  actor := private.assert_payment_permission();
  if lower(actor.role) <> 'admin'
    and (
      not public.has_active_permission('customers')
      or not public.has_active_permission('kiosks')
    ) then
    raise exception 'Không có đủ quyền thêm Kiosk cho khách hàng.' using errcode = '42501';
  end if;

  if kiosk_input is null or jsonb_typeof(kiosk_input) <> 'object' then
    raise exception 'Thông tin Kiosk không hợp lệ.' using errcode = '22023';
  end if;

  select *
  into customer_record
  from public.customers
  where id = customer_id_input
  for update;
  if not found then
    raise exception 'Khách hàng không tồn tại.';
  end if;

  facebook_name_value := nullif(trim(kiosk_input->>'facebook_name'), '');
  facebook_id_value := nullif(regexp_replace(coalesce(kiosk_input->>'facebook_id', ''), '[^0-9]', '', 'g'), '');
  if facebook_name_value is null or facebook_id_value is null
    or facebook_id_value <> trim(coalesce(kiosk_input->>'facebook_id', '')) then
    raise exception 'Tên và Facebook ID dạng số của Kiosk là bắt buộc.' using errcode = '22023';
  end if;

  begin
    months_value := (kiosk_input->>'months')::integer;
    discount_value := coalesce((kiosk_input->>'discount')::numeric, 0);
    select *
    into business_type_record
    from public.business_types bt
    where bt.id = (kiosk_input->>'business_type_id')::bigint
      and bt.is_active = true;
  exception when others then
    raise exception 'Gói dịch vụ, thời hạn hoặc giảm giá không hợp lệ.' using errcode = '22023';
  end;
  if not found then
    raise exception 'Gói dịch vụ không tồn tại hoặc đã ngừng hoạt động.';
  end if;
  if months_value < 1 or months_value > 120 then
    raise exception 'Số tháng phải từ 1 đến 120.' using errcode = '22023';
  end if;

  total_value := business_type_record.price_per_month * months_value - discount_value;
  discount_reason_value := nullif(trim(kiosk_input->>'discount_reason'), '');
  if discount_value < 0 or total_value <= 0 then
    raise exception 'Giá trị thanh toán không hợp lệ.' using errcode = '22023';
  end if;
  if discount_value > 0 and discount_reason_value is null then
    raise exception 'Lý do giảm giá là bắt buộc.' using errcode = '22023';
  end if;

  group_link_value := nullif(trim(kiosk_input->>'facebook_group_link'), '');
  if group_link_value is null then
    select case
      when nullif(trim(s.value), '') ~ '^[0-9]+$'
        then 'https://www.facebook.com/groups/' || trim(s.value) || '/user/'
          || facebook_id_value || '/'
      else null
    end
    into group_link_value
    from public.settings s
    where s.key = 'facebook_group_id';
  end if;

  insert into public.kiosks(
    customer_id, facebook_name, facebook_id, facebook_link,
    facebook_group_link, category_id, business_type_id,
    start_date, end_date, status, auto_approve, note
  )
  values(
    customer_record.id,
    facebook_name_value,
    facebook_id_value,
    nullif(trim(kiosk_input->>'facebook_link'), ''),
    group_link_value,
    business_type_record.category_id,
    business_type_record.id,
    null,
    null,
    'pending',
    false,
    nullif(trim(kiosk_input->>'note'), '')
  )
  returning * into kiosk_record;

  insert into public.payments(
    customer_id, kiosk_id, start_date, end_date, months,
    price_per_month, discount, discount_reason, total_amount,
    payment_method, payment_status, note
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
    coalesce(nullif(trim(kiosk_input->>'payment_method'), ''), 'transfer'),
    'pending',
    nullif(trim(kiosk_input->>'note'), '')
  )
  returning * into payment_record;

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
    'kiosks',
    kiosk_record.id::text,
    'create_for_existing_customer',
    null,
    jsonb_build_object(
      'customer', to_jsonb(customer_record),
      'kiosk', to_jsonb(kiosk_record),
      'payment', to_jsonb(payment_record)
    ),
    'Thêm Kiosk cho khách hàng hiện có trong một giao dịch'
  );

  return jsonb_build_object(
    'customer', to_jsonb(customer_record),
    'kiosk', to_jsonb(kiosk_record),
    'payment', to_jsonb(payment_record),
    'businessType', to_jsonb(business_type_record),
    'preview', jsonb_build_object(
      'businessTypeName', business_type_record.name,
      'categoryId', business_type_record.category_id,
      'months', months_value,
      'startDate', null,
      'endDate', null,
      'pricePerMonth', business_type_record.price_per_month,
      'subtotal', business_type_record.price_per_month * months_value,
      'discount', discount_value,
      'totalAmount', total_value
    )
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
  payment_id_value bigint;
  payment_result jsonb;
begin
  actor := private.assert_payment_permission();
  if lower(actor.role) <> 'admin'
    and not public.has_active_permission('registration-requests') then
    raise exception 'Không có quyền duyệt đơn đăng ký.' using errcode = '42501';
  end if;

  select *
  into request_record
  from public.registration_requests
  where id = request_id_input
  for update;

  if not found then
    raise exception 'Không tìm thấy đơn đăng ký.';
  end if;
  if lower(request_record.status) <> 'pending' then
    raise exception 'Chỉ đơn Pending mới được duyệt.';
  end if;

  payment_id_value := private.registration_request_payment(request_record);
  payment_result := public.confirm_payment(
    payment_id_value,
    'Duyệt đơn đăng ký #' || request_record.id
  );

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
    'approve',
    jsonb_build_object('status', 'pending'),
    to_jsonb(request_record),
    'Duyệt đơn và xác nhận thanh toán trong một giao dịch'
  );

  return jsonb_build_object(
    'request', to_jsonb(request_record),
    'paymentResult', payment_result
  );
end;
$function$;

create or replace function public.reject_registration_request(
  request_id_input bigint,
  reason_input text
)
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
begin
  actor := private.assert_payment_permission();
  if lower(actor.role) <> 'admin'
    and not public.has_active_permission('registration-requests') then
    raise exception 'Không có quyền từ chối đơn đăng ký.' using errcode = '42501';
  end if;
  if nullif(trim(reason_input), '') is null then
    raise exception 'Lý do từ chối là bắt buộc.' using errcode = '22023';
  end if;

  select *
  into request_record
  from public.registration_requests
  where id = request_id_input
  for update;

  if not found then
    raise exception 'Không tìm thấy đơn đăng ký.';
  end if;
  if lower(request_record.status) <> 'pending' then
    raise exception 'Chỉ đơn Pending mới được từ chối.';
  end if;

  before_record := request_record;
  payment_id_value := private.registration_request_payment(request_record);
  perform public.reject_payment(payment_id_value, trim(reason_input));

  update public.registration_requests
  set
    payment_id = payment_id_value,
    status = 'rejected',
    reviewed_at = pg_catalog.now(),
    reviewed_by = actor.user_id,
    rejection_reason = trim(reason_input)
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
    'reject',
    to_jsonb(before_record),
    to_jsonb(request_record),
    trim(reason_input)
  );

  return jsonb_build_object('request', to_jsonb(request_record));
end;
$function$;

revoke all on function private.link_registration_request_payment() from public;
revoke all on function private.registration_request_payment(public.registration_requests) from public;

revoke all on function public.submit_existing_customer_kiosk(bigint, jsonb)
  from public, anon, authenticated;
grant execute on function public.submit_existing_customer_kiosk(bigint, jsonb)
  to authenticated;

revoke all on function public.approve_registration_request(bigint)
  from public, anon, authenticated;
grant execute on function public.approve_registration_request(bigint)
  to authenticated;

revoke all on function public.reject_registration_request(bigint, text)
  from public, anon, authenticated;
grant execute on function public.reject_registration_request(bigint, text)
  to authenticated;

-- Retire the pre-transaction public registration endpoint. The frontend uses
-- submit_public_registration(), which is the only supported public write path.
do $block$
begin
  if to_regprocedure(
    'public.submit_registration_request(text,text,text,text,text,text,bigint,bigint,integer,numeric,text)'
  ) is not null then
    execute 'revoke all on function public.submit_registration_request(text,text,text,text,text,text,bigint,bigint,integer,numeric,text) from public, anon, authenticated';
  end if;
end;
$block$;

do $block$
begin
  if to_regprocedure('public.get_business_types_with_stats(text)') is not null then
    execute 'alter function public.get_business_types_with_stats(text) set search_path = ''''';
  end if;
  if to_regprocedure('public.get_categories_with_stats()') is not null then
    execute 'alter function public.get_categories_with_stats() set search_path = ''''';
  end if;
end;
$block$;
