alter table public.payments
  add column if not exists transaction_type text not null default 'standard',
  add column if not exists adjusts_payment_id bigint,
  add column if not exists adjustment_reason text,
  add column if not exists service_month_delta integer not null default 0;

do $block$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'payments_adjusts_payment_id_fkey'
      and conrelid = 'public.payments'::regclass
  ) then
    alter table public.payments
      add constraint payments_adjusts_payment_id_fkey
      foreign key (adjusts_payment_id)
      references public.payments(id)
      on delete restrict;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'payments_transaction_type_check'
      and conrelid = 'public.payments'::regclass
  ) then
    alter table public.payments
      add constraint payments_transaction_type_check
      check (transaction_type in ('standard', 'adjustment'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'payments_adjustment_shape_check'
      and conrelid = 'public.payments'::regclass
  ) then
    alter table public.payments
      add constraint payments_adjustment_shape_check
      check (
        (transaction_type = 'standard'
          and adjusts_payment_id is null
          and adjustment_reason is null
          and service_month_delta = 0)
        or
        (transaction_type = 'adjustment'
          and adjusts_payment_id is not null
          and nullif(trim(adjustment_reason), '') is not null)
      );
  end if;
end;
$block$;

create index if not exists payments_adjusts_payment_id_idx
  on public.payments(adjusts_payment_id)
  where adjusts_payment_id is not null;

create or replace function private.assert_payment_permission()
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
    raise exception 'Bạn phải đăng nhập để xử lý thanh toán.'
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
          and 'payments' = any(rp.permissions)
      )
    );

  if not found then
    raise exception 'Không có quyền xử lý thanh toán.'
      using errcode = '42501';
  end if;

  return actor;
end;
$function$;

create or replace function private.write_payment_audit(
  action_input text,
  before_input jsonb,
  after_input jsonb,
  reason_input text,
  actor_input public.user_roles
)
returns void
language sql
security definer
set search_path = ''
as $function$
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
    (actor_input).user_id,
    coalesce((actor_input).display_name, (actor_input).username, 'System'),
    (actor_input).role,
    'Payment',
    action_input,
    before_input,
    after_input,
    nullif(trim(reason_input), '')
  );
$function$;

create or replace function private.protect_payment_records()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  workflow_action text := coalesce(
    current_setting('app.payment_workflow_action', true),
    ''
  );
begin
  if tg_op = 'DELETE' then
    raise exception 'Thanh toán không bao giờ được xóa cứng.'
      using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    if lower(coalesce(new.payment_status, '')) <> 'pending'
      and workflow_action <> 'adjustment' then
      raise exception 'Thanh toán mới phải bắt đầu ở trạng thái Pending.'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if lower(old.payment_status) = 'completed' then
    if new.id is distinct from old.id
      or new.created_at is distinct from old.created_at
      or new.customer_id is distinct from old.customer_id
      or new.kiosk_id is distinct from old.kiosk_id
      or new.start_date is distinct from old.start_date
      or new.end_date is distinct from old.end_date
      or new.months is distinct from old.months
      or new.price_per_month is distinct from old.price_per_month
      or new.discount is distinct from old.discount
      or new.discount_reason is distinct from old.discount_reason
      or new.total_amount is distinct from old.total_amount
      or new.payment_method is distinct from old.payment_method
      or new.payment_status is distinct from old.payment_status
      or new.confirmed_at is distinct from old.confirmed_at
      or new.confirmed_by is distinct from old.confirmed_by
      or new.transaction_type is distinct from old.transaction_type
      or new.adjusts_payment_id is distinct from old.adjusts_payment_id
      or new.adjustment_reason is distinct from old.adjustment_reason
      or new.service_month_delta is distinct from old.service_month_delta then
      raise exception 'Không được sửa trường tài chính của thanh toán Completed. Hãy tạo giao dịch điều chỉnh.'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if lower(old.payment_status) in ('rejected', 'cancelled') then
    if new is distinct from old then
      raise exception 'Thanh toán Rejected/Cancelled là trạng thái kết thúc.'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if lower(old.payment_status) <> 'pending' then
    raise exception 'Trạng thái thanh toán hiện tại không hợp lệ.'
      using errcode = '23514';
  end if;

  if lower(new.payment_status) = 'completed' and workflow_action <> 'confirm' then
    raise exception 'Chỉ confirm_payment() được hoàn thành thanh toán.'
      using errcode = '23514';
  end if;

  if lower(new.payment_status) = 'rejected' and workflow_action <> 'reject' then
    raise exception 'Chỉ reject_payment() được từ chối thanh toán.'
      using errcode = '23514';
  end if;

  if lower(new.payment_status) = 'cancelled' and workflow_action <> 'cancel' then
    raise exception 'Chỉ cancel_payment() được hủy thanh toán.'
      using errcode = '23514';
  end if;

  if lower(new.payment_status) not in ('pending', 'completed', 'rejected', 'cancelled') then
    raise exception 'Trạng thái thanh toán không hợp lệ.'
      using errcode = '23514';
  end if;

  if lower(new.payment_status) = 'pending'
    and workflow_action <> 'edit'
    and (
      new.customer_id is distinct from old.customer_id
      or new.kiosk_id is distinct from old.kiosk_id
      or new.start_date is distinct from old.start_date
      or new.end_date is distinct from old.end_date
      or new.months is distinct from old.months
      or new.price_per_month is distinct from old.price_per_month
      or new.discount is distinct from old.discount
      or new.discount_reason is distinct from old.discount_reason
      or new.total_amount is distinct from old.total_amount
      or new.payment_method is distinct from old.payment_method
    ) then
    raise exception 'Trường tài chính của thanh toán Pending phải được sửa qua update_pending_payment().'
      using errcode = '23514';
  end if;

  return new;
end;
$function$;

drop trigger if exists protect_payment_records_trigger on public.payments;
create trigger protect_payment_records_trigger
before insert or update or delete on public.payments
for each row
execute function private.protect_payment_records();

create or replace function private.sync_customer_payment_totals()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'UPDATE' and old.customer_id is not null
    and old.customer_id is distinct from new.customer_id then
    update public.customers c
    set total_paid = coalesce((
      select sum(p.total_amount)
      from public.payments p
      where p.customer_id = old.customer_id
        and lower(p.payment_status) = 'completed'
        and p.confirmed_at is not null
    ), 0)
    where c.id = old.customer_id;
  end if;

  if new.customer_id is not null then
    update public.customers c
    set total_paid = coalesce((
      select sum(p.total_amount)
      from public.payments p
      where p.customer_id = new.customer_id
        and lower(p.payment_status) = 'completed'
        and p.confirmed_at is not null
    ), 0)
    where c.id = new.customer_id;
  end if;

  if tg_op = 'UPDATE' and old.kiosk_id is not null
    and old.kiosk_id is distinct from new.kiosk_id then
    update public.kiosks k
    set total_paid = coalesce((
      select sum(p.total_amount)
      from public.payments p
      where p.kiosk_id = old.kiosk_id
        and lower(p.payment_status) = 'completed'
        and p.confirmed_at is not null
    ), 0)
    where k.id = old.kiosk_id;
  end if;

  if new.kiosk_id is not null then
    update public.kiosks k
    set total_paid = coalesce((
      select sum(p.total_amount)
      from public.payments p
      where p.kiosk_id = new.kiosk_id
        and lower(p.payment_status) = 'completed'
        and p.confirmed_at is not null
    ), 0)
    where k.id = new.kiosk_id;
  end if;

  return new;
end;
$function$;

drop trigger if exists sync_customer_payment_totals_trigger on public.payments;
create trigger sync_customer_payment_totals_trigger
after insert or update on public.payments
for each row
execute function private.sync_customer_payment_totals();

create or replace function public.create_renewal_payment(
  kiosk_id_input bigint,
  months_input integer,
  discount_input numeric default 0,
  discount_reason_input text default null,
  note_input text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor public.user_roles%rowtype;
  kiosk_record public.kiosks%rowtype;
  package_record public.business_types%rowtype;
  payment_record public.payments%rowtype;
  normalized_discount numeric := coalesce(discount_input, 0);
  calculated_total numeric;
begin
  actor := private.assert_payment_permission();

  if months_input is null or months_input < 1 then
    raise exception 'Số tháng phải là số nguyên lớn hơn 0.';
  end if;

  if normalized_discount < 0 then
    raise exception 'Giảm giá không hợp lệ.';
  end if;

  select *
  into kiosk_record
  from public.kiosks
  where id = kiosk_id_input;

  if not found then
    raise exception 'Không tìm thấy Kiosk.';
  end if;

  if kiosk_record.customer_id is null then
    raise exception 'Kiosk thiếu khách hàng.';
  end if;

  perform 1 from public.customers where id = kiosk_record.customer_id;
  if not found then
    raise exception 'Khách hàng của Kiosk không tồn tại.';
  end if;

  select *
  into package_record
  from public.business_types
  where id = kiosk_record.business_type_id
    and is_active = true;

  if not found then
    raise exception 'Gói dịch vụ của Kiosk không tồn tại hoặc đã ngừng hoạt động.';
  end if;

  if package_record.price_per_month is null or package_record.price_per_month < 0 then
    raise exception 'Giá gói dịch vụ không hợp lệ.';
  end if;

  calculated_total := package_record.price_per_month * months_input - normalized_discount;
  if calculated_total < 0 then
    raise exception 'Giảm giá không được lớn hơn tạm tính.';
  end if;

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
    note,
    transaction_type,
    service_month_delta
  )
  values(
    kiosk_record.customer_id,
    kiosk_record.id,
    null,
    null,
    months_input,
    package_record.price_per_month,
    normalized_discount,
    nullif(trim(discount_reason_input), ''),
    calculated_total,
    'transfer',
    'pending',
    nullif(trim(note_input), ''),
    'standard',
    0
  )
  returning * into payment_record;

  perform private.write_payment_audit(
    'create_renewal',
    null,
    to_jsonb(payment_record),
    'Tạo yêu cầu gia hạn',
    actor
  );

  return jsonb_build_object(
    'payment', to_jsonb(payment_record),
    'package', jsonb_build_object(
      'id', package_record.id,
      'name', package_record.name,
      'pricePerMonth', package_record.price_per_month
    )
  );
end;
$function$;

create or replace function public.update_pending_payment(
  payment_id_input bigint,
  months_input integer,
  discount_input numeric,
  payment_method_input text,
  discount_reason_input text default null,
  note_input text default null,
  reason_input text default 'Cập nhật thanh toán Pending'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor public.user_roles%rowtype;
  payment_record public.payments%rowtype;
  before_record public.payments%rowtype;
  kiosk_record public.kiosks%rowtype;
  package_record public.business_types%rowtype;
  calculated_total numeric;
begin
  actor := private.assert_payment_permission();

  select *
  into payment_record
  from public.payments
  where id = payment_id_input
  for update;

  if not found then
    raise exception 'Không tìm thấy thanh toán.';
  end if;

  if lower(payment_record.payment_status) <> 'pending' then
    raise exception 'Chỉ thanh toán Pending mới được sửa.';
  end if;

  before_record := payment_record;

  if months_input is null or months_input < 1 then
    raise exception 'Số tháng phải là số nguyên lớn hơn 0.';
  end if;

  if discount_input is null or discount_input < 0 then
    raise exception 'Giảm giá không hợp lệ.';
  end if;

  if nullif(trim(payment_method_input), '') is null then
    raise exception 'Phương thức thanh toán là bắt buộc.';
  end if;

  select *
  into kiosk_record
  from public.kiosks
  where id = payment_record.kiosk_id;

  if not found or kiosk_record.customer_id <> payment_record.customer_id then
    raise exception 'Liên kết Khách hàng/Kiosk của thanh toán không hợp lệ.';
  end if;

  select *
  into package_record
  from public.business_types
  where id = kiosk_record.business_type_id
    and is_active = true;

  if not found or package_record.price_per_month is null or package_record.price_per_month < 0 then
    raise exception 'Gói dịch vụ không hợp lệ.';
  end if;

  calculated_total := package_record.price_per_month * months_input - discount_input;
  if calculated_total < 0 then
    raise exception 'Giảm giá không được lớn hơn tạm tính.';
  end if;

  perform set_config('app.payment_workflow_action', 'edit', true);

  update public.payments
  set
    months = months_input,
    price_per_month = package_record.price_per_month,
    discount = discount_input,
    discount_reason = nullif(trim(discount_reason_input), ''),
    total_amount = calculated_total,
    payment_method = trim(payment_method_input),
    start_date = null,
    end_date = null,
    note = nullif(trim(note_input), '')
  where id = payment_record.id
  returning * into payment_record;

  perform private.write_payment_audit(
    'update_pending',
    to_jsonb(before_record),
    to_jsonb(payment_record),
    reason_input,
    actor
  );

  return to_jsonb(payment_record);
end;
$function$;

create or replace function public.update_payment_note(
  payment_id_input bigint,
  note_input text,
  reason_input text default 'Cập nhật ghi chú thanh toán'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor public.user_roles%rowtype;
  payment_record public.payments%rowtype;
  before_record public.payments%rowtype;
begin
  actor := private.assert_payment_permission();

  select *
  into payment_record
  from public.payments
  where id = payment_id_input
  for update;

  if not found then
    raise exception 'Không tìm thấy thanh toán.';
  end if;

  before_record := payment_record;

  update public.payments
  set note = nullif(trim(note_input), '')
  where id = payment_record.id
  returning * into payment_record;

  perform private.write_payment_audit(
    'update_note',
    to_jsonb(before_record),
    to_jsonb(payment_record),
    reason_input,
    actor
  );

  return to_jsonb(payment_record);
end;
$function$;

create or replace function public.confirm_payment(
  payment_id_input bigint,
  reason_input text default 'Xác nhận thanh toán'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor public.user_roles%rowtype;
  payment_record public.payments%rowtype;
  before_record public.payments%rowtype;
  customer_record public.customers%rowtype;
  kiosk_record public.kiosks%rowtype;
  package_record public.business_types%rowtype;
  confirmation_timestamp timestamptz := now();
  confirmation_date date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  effective_start_date date;
  calculated_end_date date;
  expected_total numeric;
begin
  actor := private.assert_payment_permission();

  select *
  into payment_record
  from public.payments
  where id = payment_id_input
  for update;

  if not found then
    raise exception 'Không tìm thấy thanh toán.';
  end if;

  if lower(payment_record.payment_status) <> 'pending' then
    raise exception 'Chỉ thanh toán Pending mới được xác nhận.';
  end if;

  if payment_record.transaction_type <> 'standard' then
    raise exception 'Giao dịch điều chỉnh không dùng confirm_payment().';
  end if;

  before_record := payment_record;

  select *
  into customer_record
  from public.customers
  where id = payment_record.customer_id
  for update;

  if not found then
    raise exception 'Khách hàng của thanh toán không tồn tại.';
  end if;

  select *
  into kiosk_record
  from public.kiosks
  where id = payment_record.kiosk_id
  for update;

  if not found then
    raise exception 'Kiosk của thanh toán không tồn tại.';
  end if;

  if kiosk_record.customer_id <> customer_record.id then
    raise exception 'Kiosk không thuộc khách hàng của thanh toán.';
  end if;

  select *
  into package_record
  from public.business_types
  where id = kiosk_record.business_type_id
    and is_active = true;

  if not found then
    raise exception 'Gói dịch vụ không tồn tại hoặc đã ngừng hoạt động.';
  end if;

  if payment_record.months is null or payment_record.months < 1 then
    raise exception 'Số tháng thanh toán không hợp lệ.';
  end if;

  if payment_record.price_per_month is null or payment_record.price_per_month < 0
    or payment_record.discount is null or payment_record.discount < 0
    or payment_record.total_amount is null or payment_record.total_amount <= 0 then
    raise exception 'Giá trị tài chính của thanh toán không hợp lệ.';
  end if;

  expected_total := payment_record.price_per_month * payment_record.months
    - payment_record.discount;

  if payment_record.total_amount <> expected_total then
    raise exception 'Tổng tiền không khớp giá, số tháng và giảm giá.';
  end if;

  if lower(kiosk_record.status) = 'active'
    and kiosk_record.end_date is not null
    and kiosk_record.end_date >= confirmation_date then
    effective_start_date := kiosk_record.end_date + 1;
  else
    effective_start_date := confirmation_date;
  end if;

  calculated_end_date := (
    effective_start_date + make_interval(months => payment_record.months)
  )::date;

  perform set_config('app.payment_workflow_action', 'confirm', true);

  update public.payments
  set
    payment_status = 'completed',
    confirmed_by = actor.user_id,
    confirmed_at = confirmation_timestamp,
    start_date = effective_start_date,
    end_date = calculated_end_date
  where id = payment_record.id
  returning * into payment_record;

  update public.kiosks
  set
    status = 'active',
    start_date = effective_start_date,
    end_date = calculated_end_date
  where id = kiosk_record.id;

  update public.customers
  set
    status = case
      when lower(coalesce(status, '')) = 'pending' then 'active'
      else status
    end,
    total_kiosks = (
      select count(*) from public.kiosks k where k.customer_id = customer_record.id
    )
  where id = customer_record.id;

  perform private.write_payment_audit(
    'confirm',
    to_jsonb(before_record),
    to_jsonb(payment_record),
    reason_input,
    actor
  );

  return jsonb_build_object(
    'payment', to_jsonb(payment_record),
    'kiosk', (
      select to_jsonb(k) from public.kiosks k where k.id = kiosk_record.id
    ),
    'customer', (
      select to_jsonb(c) from public.customers c where c.id = customer_record.id
    )
  );
end;
$function$;

create or replace function public.cancel_payment(
  payment_id_input bigint,
  reason_input text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor public.user_roles%rowtype;
  payment_record public.payments%rowtype;
  before_record public.payments%rowtype;
begin
  actor := private.assert_payment_permission();

  if nullif(trim(reason_input), '') is null then
    raise exception 'Lý do hủy là bắt buộc.';
  end if;

  select * into payment_record
  from public.payments
  where id = payment_id_input
  for update;

  if not found or lower(payment_record.payment_status) <> 'pending' then
    raise exception 'Chỉ thanh toán Pending mới được hủy.';
  end if;

  before_record := payment_record;
  perform set_config('app.payment_workflow_action', 'cancel', true);

  update public.payments
  set payment_status = 'cancelled'
  where id = payment_record.id
  returning * into payment_record;

  perform private.write_payment_audit(
    'cancel',
    to_jsonb(before_record),
    to_jsonb(payment_record),
    reason_input,
    actor
  );

  return to_jsonb(payment_record);
end;
$function$;

create or replace function public.reject_payment(
  payment_id_input bigint,
  reason_input text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor public.user_roles%rowtype;
  payment_record public.payments%rowtype;
  before_record public.payments%rowtype;
begin
  actor := private.assert_payment_permission();

  if nullif(trim(reason_input), '') is null then
    raise exception 'Lý do từ chối là bắt buộc.';
  end if;

  select * into payment_record
  from public.payments
  where id = payment_id_input
  for update;

  if not found or lower(payment_record.payment_status) <> 'pending' then
    raise exception 'Chỉ thanh toán Pending mới được từ chối.';
  end if;

  before_record := payment_record;
  perform set_config('app.payment_workflow_action', 'reject', true);

  update public.payments
  set payment_status = 'rejected'
  where id = payment_record.id
  returning * into payment_record;

  perform private.write_payment_audit(
    'reject',
    to_jsonb(before_record),
    to_jsonb(payment_record),
    reason_input,
    actor
  );

  return to_jsonb(payment_record);
end;
$function$;

create or replace function public.create_payment_adjustment(
  original_payment_id_input bigint,
  amount_delta_input numeric,
  service_month_delta_input integer,
  reason_input text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor public.user_roles%rowtype;
  original_record public.payments%rowtype;
  adjustment_record public.payments%rowtype;
  kiosk_record public.kiosks%rowtype;
  confirmation_timestamp timestamptz := now();
  confirmation_date date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  adjusted_start_date date;
  adjusted_end_date date;
  previous_start_date date;
  previous_end_date date;
begin
  actor := private.assert_payment_permission();

  if nullif(trim(reason_input), '') is null then
    raise exception 'Lý do điều chỉnh là bắt buộc.';
  end if;

  if amount_delta_input is null or amount_delta_input = 0 then
    raise exception 'Số tiền điều chỉnh phải khác 0.';
  end if;

  select *
  into original_record
  from public.payments
  where id = original_payment_id_input
  for update;

  if not found
    or lower(original_record.payment_status) <> 'completed'
    or original_record.confirmed_at is null then
    raise exception 'Chỉ được điều chỉnh thanh toán Completed hợp lệ.';
  end if;

  if original_record.transaction_type <> 'standard' then
    raise exception 'Không được tạo điều chỉnh từ một giao dịch điều chỉnh.';
  end if;

  if exists (
    select 1
    from public.payments p
    where p.adjusts_payment_id = original_record.id
      and p.transaction_type = 'adjustment'
      and lower(p.payment_status) = 'completed'
  ) then
    raise exception 'Thanh toán này đã có giao dịch điều chỉnh.';
  end if;

  select *
  into kiosk_record
  from public.kiosks
  where id = original_record.kiosk_id
  for update;

  if not found then
    raise exception 'Kiosk của thanh toán không tồn tại.';
  end if;

  if service_month_delta_input <> 0 and exists (
    select 1
    from public.payments p
    where p.kiosk_id = original_record.kiosk_id
      and lower(p.payment_status) = 'completed'
      and p.confirmed_at is not null
      and p.transaction_type = 'standard'
      and (p.confirmed_at, p.id) > (original_record.confirmed_at, original_record.id)
  ) then
    raise exception 'Chỉ được điều chỉnh kỳ hạn của thanh toán dịch vụ mới nhất.';
  end if;

  if service_month_delta_input < 0
    and abs(service_month_delta_input) > original_record.months then
    raise exception 'Số tháng đảo ngược vượt quá số tháng của thanh toán gốc.';
  end if;

  if service_month_delta_input is null then
    raise exception 'Số tháng điều chỉnh không hợp lệ.';
  end if;

  if service_month_delta_input < 0
    and (original_record.start_date is null or original_record.end_date is null) then
    raise exception 'Thanh toán gốc thiếu kỳ hạn để đảo ngược.';
  end if;

  adjusted_start_date := kiosk_record.start_date;
  adjusted_end_date := kiosk_record.end_date;

  if service_month_delta_input > 0 then
    adjusted_start_date := case
      when lower(kiosk_record.status) = 'active'
        and kiosk_record.end_date is not null
        and kiosk_record.end_date >= confirmation_date
      then kiosk_record.end_date + 1
      else confirmation_date
    end;
    adjusted_end_date := (
      adjusted_start_date + make_interval(months => service_month_delta_input)
    )::date;
  elsif service_month_delta_input < 0 then
    if abs(service_month_delta_input) = original_record.months then
      select p.start_date, p.end_date
      into previous_start_date, previous_end_date
      from public.payments p
      where p.kiosk_id = original_record.kiosk_id
        and lower(p.payment_status) = 'completed'
        and p.confirmed_at is not null
        and p.transaction_type = 'standard'
        and (p.confirmed_at, p.id) < (original_record.confirmed_at, original_record.id)
      order by p.confirmed_at desc, p.id desc
      limit 1;

      adjusted_start_date := previous_start_date;
      adjusted_end_date := previous_end_date;
    else
      adjusted_end_date := (
        kiosk_record.end_date
        - make_interval(months => abs(service_month_delta_input))
      )::date;
    end if;
  end if;

  perform set_config('app.payment_workflow_action', 'adjustment', true);

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
    confirmed_at,
    confirmed_by,
    note,
    transaction_type,
    adjusts_payment_id,
    adjustment_reason,
    service_month_delta
  )
  values(
    original_record.customer_id,
    original_record.kiosk_id,
    adjusted_start_date,
    adjusted_end_date,
    greatest(abs(service_month_delta_input), 1),
    0,
    0,
    null,
    amount_delta_input,
    original_record.payment_method,
    'completed',
    confirmation_timestamp,
    actor.user_id,
    trim(reason_input),
    'adjustment',
    original_record.id,
    trim(reason_input),
    service_month_delta_input
  )
  returning * into adjustment_record;

  update public.kiosks
  set
    start_date = case
      when service_month_delta_input <> 0 then adjusted_start_date
      else start_date
    end,
    end_date = adjusted_end_date,
    status = case
      when service_month_delta_input > 0 then 'active'
      when service_month_delta_input < 0 and adjusted_end_date is null then 'expired'
      when adjusted_end_date is not null and adjusted_end_date < confirmation_date then 'expired'
      when service_month_delta_input < 0 then 'active'
      else status
    end
  where id = original_record.kiosk_id;

  perform private.write_payment_audit(
    'adjustment',
    to_jsonb(original_record),
    to_jsonb(adjustment_record),
    reason_input,
    actor
  );

  return jsonb_build_object(
    'originalPayment', to_jsonb(original_record),
    'adjustment', to_jsonb(adjustment_record),
    'kiosk', (
      select to_jsonb(k) from public.kiosks k where k.id = original_record.kiosk_id
    ),
    'customer', (
      select to_jsonb(c) from public.customers c where c.id = original_record.customer_id
    )
  );
end;
$function$;

create or replace function public.get_payment_summary(
  search_input text default null,
  status_input text default null,
  payment_method_input text default null,
  business_type_id_input bigint default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  actor public.user_roles%rowtype;
  month_start timestamptz := date_trunc(
    'month',
    now() at time zone 'Asia/Ho_Chi_Minh'
  ) at time zone 'Asia/Ho_Chi_Minh';
  next_month_start timestamptz;
  result jsonb;
begin
  actor := private.assert_payment_permission();
  next_month_start := month_start + interval '1 month';

  select jsonb_build_object(
    'totalRevenue', coalesce(sum(p.total_amount) filter (
      where lower(p.payment_status) = 'completed'
        and p.confirmed_at is not null
    ), 0),
    'monthRevenue', coalesce(sum(p.total_amount) filter (
      where lower(p.payment_status) = 'completed'
        and p.confirmed_at is not null
        and p.confirmed_at >= month_start
        and p.confirmed_at < next_month_start
    ), 0),
    'transferRevenue', coalesce(sum(p.total_amount) filter (
      where lower(p.payment_status) = 'completed'
        and p.confirmed_at is not null
        and lower(coalesce(p.payment_method, '')) in (
          'transfer', 'bank_transfer', 'chuyen_khoan', 'chuyển khoản'
        )
    ), 0),
    'pendingCount', count(*) filter (
      where lower(p.payment_status) = 'pending'
    )
  )
  into result
  from public.payments p
  left join public.customers c on c.id = p.customer_id
  left join public.kiosks k on k.id = p.kiosk_id
  left join public.business_types bt on bt.id = k.business_type_id
  where (status_input is null or lower(p.payment_status) = lower(status_input))
    and (payment_method_input is null or lower(p.payment_method) = lower(payment_method_input))
    and (business_type_id_input is null or k.business_type_id = business_type_id_input)
    and (
      nullif(trim(search_input), '') is null
      or p.payment_status ilike '%' || trim(search_input) || '%'
      or coalesce(p.payment_method, '') ilike '%' || trim(search_input) || '%'
      or coalesce(p.discount_reason, '') ilike '%' || trim(search_input) || '%'
      or coalesce(p.note, '') ilike '%' || trim(search_input) || '%'
      or coalesce(c.facebook_name, '') ilike '%' || trim(search_input) || '%'
      or coalesce(c.facebook_id, '') ilike '%' || trim(search_input) || '%'
      or coalesce(c.phone, '') ilike '%' || trim(search_input) || '%'
      or coalesce(k.facebook_name, '') ilike '%' || trim(search_input) || '%'
      or coalesce(k.facebook_id, '') ilike '%' || trim(search_input) || '%'
      or coalesce(bt.name, '') ilike '%' || trim(search_input) || '%'
    );

  return coalesce(result, jsonb_build_object(
    'totalRevenue', 0,
    'monthRevenue', 0,
    'transferRevenue', 0,
    'pendingCount', 0
  ));
end;
$function$;

revoke all on function private.assert_payment_permission() from public;
revoke all on function private.write_payment_audit(text, jsonb, jsonb, text, public.user_roles) from public;
revoke all on function private.protect_payment_records() from public;
revoke all on function private.sync_customer_payment_totals() from public;

revoke all on function public.create_renewal_payment(bigint, integer, numeric, text, text) from public, anon;
revoke all on function public.update_pending_payment(bigint, integer, numeric, text, text, text, text) from public, anon;
revoke all on function public.update_payment_note(bigint, text, text) from public, anon;
revoke all on function public.confirm_payment(bigint, text) from public, anon;
revoke all on function public.cancel_payment(bigint, text) from public, anon;
revoke all on function public.reject_payment(bigint, text) from public, anon;
revoke all on function public.create_payment_adjustment(bigint, numeric, integer, text) from public, anon;
revoke all on function public.get_payment_summary(text, text, text, bigint) from public, anon;

grant execute on function public.create_renewal_payment(bigint, integer, numeric, text, text) to authenticated;
grant execute on function public.update_pending_payment(bigint, integer, numeric, text, text, text, text) to authenticated;
grant execute on function public.update_payment_note(bigint, text, text) to authenticated;
grant execute on function public.confirm_payment(bigint, text) to authenticated;
grant execute on function public.cancel_payment(bigint, text) to authenticated;
grant execute on function public.reject_payment(bigint, text) to authenticated;
grant execute on function public.create_payment_adjustment(bigint, numeric, integer, text) to authenticated;
grant execute on function public.get_payment_summary(text, text, text, bigint) to authenticated;
