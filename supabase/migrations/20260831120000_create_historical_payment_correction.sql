-- Allow a System Admin to correct an incorrectly imported, completed payment
-- in place. This is deliberately not a renewal or an adjustment transaction:
-- the original payment remains the single revenue row and all provider/payment
-- identity fields remain immutable.

create or replace function private.protect_payment_records()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  workflow_action text := coalesce(
    pg_catalog.current_setting('app.payment_workflow_action', true),
    ''
  );
begin
  if tg_op = 'DELETE' then
    raise exception 'Thanh toán không bao giờ được xóa cứng.' using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    if pg_catalog.lower(coalesce(new.payment_status, '')) <> 'pending'
      and workflow_action <> 'adjustment' then
      raise exception 'Thanh toán mới phải bắt đầu ở trạng thái Pending.' using errcode = '23514';
    end if;
    return new;
  end if;

  if pg_catalog.lower(old.payment_status) = 'completed' then
    if workflow_action = 'historical_correction' then
      -- Future columns are protected by default. Only these four explicitly
      -- audited historical fields may differ inside the dedicated RPC.
      if (
        pg_catalog.to_jsonb(new)
          - array['start_date', 'end_date', 'months', 'total_amount']::text[]
      ) is distinct from (
        pg_catalog.to_jsonb(old)
          - array['start_date', 'end_date', 'months', 'total_amount']::text[]
      ) then
        raise exception 'Sửa dữ liệu lịch sử chỉ được đổi ngày, số tháng và số tiền.'
          using errcode = '42501';
      end if;
      return new;
    end if;

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

  if pg_catalog.lower(old.payment_status) in ('rejected', 'cancelled') then
    if new is distinct from old then
      raise exception 'Thanh toán Rejected/Cancelled là trạng thái kết thúc.' using errcode = '23514';
    end if;
    return new;
  end if;

  if pg_catalog.lower(old.payment_status) <> 'pending' then
    raise exception 'Trạng thái thanh toán hiện tại không hợp lệ.' using errcode = '23514';
  end if;
  if pg_catalog.lower(new.payment_status) = 'completed' and workflow_action <> 'confirm' then
    raise exception 'Chỉ confirm_payment() được hoàn thành thanh toán.' using errcode = '23514';
  end if;
  if pg_catalog.lower(new.payment_status) = 'rejected' and workflow_action <> 'reject' then
    raise exception 'Chỉ reject_payment() được từ chối thanh toán.' using errcode = '23514';
  end if;
  if pg_catalog.lower(new.payment_status) = 'cancelled' and workflow_action <> 'cancel' then
    raise exception 'Chỉ cancel_payment() được hủy thanh toán.' using errcode = '23514';
  end if;
  if pg_catalog.lower(new.payment_status) not in ('pending', 'completed', 'rejected', 'cancelled') then
    raise exception 'Trạng thái thanh toán không hợp lệ.' using errcode = '23514';
  end if;
  if pg_catalog.lower(new.payment_status) = 'pending'
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
revoke all on function private.protect_payment_records() from public;
-- The existing deferred trigger normally makes the newly completed period the
-- Kiosk expiry. Historical correction calculates the authoritative expiry in
-- the RPC instead, so this backstop must not overwrite that result at commit.
create or replace function private.sync_completed_renewal_kiosk_period()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if coalesce(
    pg_catalog.current_setting('app.payment_workflow_action', true),
    ''
  ) = 'historical_correction' then
    return null;
  end if;

  if new.registration_batch_id is null
    and new.payment_status = 'completed'
    and new.start_date is not null
    and new.end_date is not null then
    update public.kiosks
    set status = 'active', end_date = new.end_date
    where id = new.kiosk_id;
  end if;
  return null;
end;
$function$;
revoke all on function private.sync_completed_renewal_kiosk_period() from public;
create or replace function public.correct_historical_payment(
  payment_id_input bigint,
  start_date_input date,
  end_date_input date,
  months_input integer,
  total_amount_input numeric,
  reason_input text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_record public.user_profiles%rowtype;
  before_payment public.payments%rowtype;
  after_payment public.payments%rowtype;
  kiosk_record public.kiosks%rowtype;
  customer_record public.customers%rowtype;
  authoritative_end_date date;
  normalized_reason text := pg_catalog.btrim(coalesce(reason_input, ''));
  kiosk_end_date_before date;
  kiosk_end_date_after date;
begin
  if not public.is_system_admin() then
    raise exception 'Chỉ System Admin được sửa dữ liệu thanh toán lịch sử.'
      using errcode = '42501';
  end if;

  select * into actor_record
  from public.user_profiles
  where user_id = (select auth.uid())
    and status = 'active'
    and web_access_enabled
    and is_system_admin;
  if not found then
    raise exception 'Phiên System Admin không còn hiệu lực.' using errcode = '42501';
  end if;

  if payment_id_input is null or payment_id_input < 1 then
    raise exception 'Thanh toán không hợp lệ.' using errcode = '22023';
  end if;
  if start_date_input is null or end_date_input is null then
    raise exception 'Ngày bắt đầu và ngày kết thúc là bắt buộc.' using errcode = '22023';
  end if;
  if end_date_input < start_date_input then
    raise exception 'Ngày kết thúc không được trước ngày bắt đầu.' using errcode = '22023';
  end if;
  if months_input is null or months_input < 1 then
    raise exception 'Số tháng phải là số nguyên lớn hơn 0.' using errcode = '22023';
  end if;
  if total_amount_input is null or total_amount_input <= 0 then
    raise exception 'Số tiền phải lớn hơn 0.' using errcode = '22023';
  end if;
  if normalized_reason = '' then
    raise exception 'Lý do chỉnh sửa là bắt buộc.' using errcode = '22023';
  end if;
  if pg_catalog.length(normalized_reason) > 1000 then
    raise exception 'Lý do chỉnh sửa không được vượt quá 1000 ký tự.' using errcode = '22023';
  end if;

  select * into before_payment
  from public.payments
  where id = payment_id_input
  for update;
  if not found then
    raise exception 'Không tìm thấy thanh toán.' using errcode = 'P0002';
  end if;
  if pg_catalog.lower(coalesce(before_payment.payment_status, '')) <> 'completed'
    or before_payment.confirmed_at is null then
    raise exception 'Chỉ được sửa thanh toán đã hoàn thành và đã ghi nhận thời điểm xác nhận.'
      using errcode = '23514';
  end if;
  if pg_catalog.lower(coalesce(before_payment.transaction_type, 'standard')) = 'adjustment' then
    raise exception 'Không sửa trực tiếp giao dịch điều chỉnh.' using errcode = '23514';
  end if;
  if before_payment.registration_batch_id is not null then
    raise exception 'Thanh toán theo lô phải được đối soát ở cấp lô đăng ký.' using errcode = '23514';
  end if;
  if before_payment.kiosk_id is null then
    raise exception 'Thanh toán không gắn với Kiosk.' using errcode = '23514';
  end if;

  select * into kiosk_record
  from public.kiosks
  where id = before_payment.kiosk_id
  for update;
  if not found then
    raise exception 'Kiosk của thanh toán không tồn tại.' using errcode = 'P0002';
  end if;
  if kiosk_record.customer_id is distinct from before_payment.customer_id then
    raise exception 'Kiosk không thuộc khách hàng của thanh toán.' using errcode = '23514';
  end if;

  select * into customer_record
  from public.customers
  where id = before_payment.customer_id
  for update;
  if not found then
    raise exception 'Khách hàng của thanh toán không tồn tại.' using errcode = 'P0002';
  end if;

  if before_payment.start_date is not distinct from start_date_input
    and before_payment.end_date is not distinct from end_date_input
    and before_payment.months is not distinct from months_input
    and before_payment.total_amount is not distinct from total_amount_input then
    raise exception 'Dữ liệu mới không có thay đổi.' using errcode = '22023';
  end if;

  kiosk_end_date_before := kiosk_record.end_date;
  perform pg_catalog.set_config('app.payment_workflow_action', 'historical_correction', true);

  update public.payments
  set start_date = start_date_input,
      end_date = end_date_input,
      months = months_input,
      total_amount = total_amount_input
  where id = before_payment.id
  returning * into after_payment;

  -- Include both individual renewal payments and completed registration-batch
  -- item periods. This prevents an older corrected payment from shortening a
  -- Kiosk that already has a later completed service period.
  select pg_catalog.max(period_end) into authoritative_end_date
  from (
    select p.end_date as period_end
    from public.payments p
    where p.registration_batch_id is null
      and p.kiosk_id = before_payment.kiosk_id
      and pg_catalog.lower(coalesce(p.payment_status, '')) = 'completed'
      and p.confirmed_at is not null
      and pg_catalog.lower(coalesce(p.transaction_type, 'standard')) <> 'adjustment'
      and p.end_date is not null

    union all

    select i.end_date as period_end
    from public.registration_batch_items i
    join public.registration_batches b on b.id = i.batch_id
    join public.payments p on p.id = b.payment_id
    where i.kiosk_id = before_payment.kiosk_id
      and p.registration_batch_id = b.id
      and pg_catalog.lower(coalesce(p.payment_status, '')) = 'completed'
      and p.confirmed_at is not null
      and i.end_date is not null
  ) completed_periods;

  update public.kiosks k
  set end_date = case
    when k.end_date is not distinct from before_payment.end_date then authoritative_end_date
    when k.end_date is null then authoritative_end_date
    when authoritative_end_date > k.end_date then authoritative_end_date
    else k.end_date
  end
  where k.id = before_payment.kiosk_id
  returning k.end_date into kiosk_end_date_after;

  insert into public.audit_logs (
    actor_id, actor_name, actor_role, actor_type, module, entity, record_id,
    action, before, after, reason
  ) values (
    actor_record.user_id,
    coalesce(actor_record.display_name, actor_record.username, 'System Admin'),
    'system_admin',
    'staff',
    'Payment',
    'payments',
    before_payment.id::text,
    'update',
    pg_catalog.jsonb_build_object(
      'correction_type', 'historical_payment',
      'payment_id', before_payment.id,
      'kiosk_id', before_payment.kiosk_id,
      'customer_id', before_payment.customer_id,
      'start_date', before_payment.start_date,
      'end_date', before_payment.end_date,
      'months', before_payment.months,
      'total_amount', before_payment.total_amount,
      'kiosk_end_date', kiosk_end_date_before
    ),
    pg_catalog.jsonb_build_object(
      'correction_type', 'historical_payment',
      'payment_id', after_payment.id,
      'kiosk_id', after_payment.kiosk_id,
      'customer_id', after_payment.customer_id,
      'start_date', after_payment.start_date,
      'end_date', after_payment.end_date,
      'months', after_payment.months,
      'total_amount', after_payment.total_amount,
      'kiosk_end_date', kiosk_end_date_after
    ),
    normalized_reason
  );

  return pg_catalog.jsonb_build_object(
    'payment', pg_catalog.to_jsonb(after_payment),
    'kiosk', (
      select pg_catalog.to_jsonb(k)
      from public.kiosks k
      where k.id = before_payment.kiosk_id
    ),
    'audit', pg_catalog.jsonb_build_object(
      'reason', normalized_reason,
      'corrected_by', actor_record.user_id
    )
  );
end;
$function$;
comment on function public.correct_historical_payment(bigint, date, date, integer, numeric, text) is
  'System Admin-only atomic correction of an existing completed individual payment; does not create a renewal or adjustment.';
revoke all on function public.correct_historical_payment(bigint, date, date, integer, numeric, text)
  from public, anon, authenticated;
grant execute on function public.correct_historical_payment(bigint, date, date, integer, numeric, text)
  to authenticated;
