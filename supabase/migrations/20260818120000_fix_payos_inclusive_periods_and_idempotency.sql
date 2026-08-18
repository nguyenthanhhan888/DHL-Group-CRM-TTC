-- Follow-up to 20260815120000_harden_payos_payment_intents.sql.
-- Keep one inclusive period rule in the finalizer itself and remove the
-- generic trigger that previously performed a second, hidden date mutation.

drop trigger if exists normalize_payos_renewal_period_trigger on public.payments;
drop function if exists private.normalize_payos_renewal_period();

create or replace function private.confirm_crm_payment_from_payos(
  payment_id_input bigint,
  reason_input text default 'PayOS paid'
)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  payment_record public.payments%rowtype;
  before_record public.payments%rowtype;
  customer_record public.customers%rowtype;
  kiosk_record public.kiosks%rowtype;
  package_record public.business_types%rowtype;
  confirmation_timestamp timestamptz := pg_catalog.now();
  confirmation_date date := (pg_catalog.now() at time zone 'Asia/Ho_Chi_Minh')::date;
  effective_start_date date;
  calculated_end_date date;
  expected_total numeric;
begin
  select * into payment_record from public.payments where id=payment_id_input for update;
  if not found then raise exception 'Không tìm thấy thanh toán.'; end if;
  if lower(payment_record.payment_status)<>'pending' then raise exception 'Chỉ thanh toán Pending mới được xác nhận.'; end if;
  if payment_record.transaction_type<>'standard' then raise exception 'Giao dịch điều chỉnh không dùng xác nhận PayOS.'; end if;
  before_record:=payment_record;

  select * into customer_record from public.customers where id=payment_record.customer_id for update;
  if not found then raise exception 'Khách hàng của thanh toán không tồn tại.'; end if;
  select * into kiosk_record from public.kiosks where id=payment_record.kiosk_id for update;
  if not found then raise exception 'Kiosk của thanh toán không tồn tại.'; end if;
  if kiosk_record.customer_id<>customer_record.id then raise exception 'Kiosk không thuộc khách hàng của thanh toán.'; end if;
  select * into package_record from public.business_types where id=kiosk_record.business_type_id and is_active=true;
  if not found then raise exception 'Gói dịch vụ không tồn tại hoặc đã ngừng hoạt động.'; end if;
  if payment_record.months is null or payment_record.months<1 then raise exception 'Số tháng thanh toán không hợp lệ.'; end if;
  if payment_record.price_per_month is null or payment_record.price_per_month<0
    or payment_record.discount is null or payment_record.discount<0
    or payment_record.total_amount is null or payment_record.total_amount<=0 then
    raise exception 'Giá trị tài chính của thanh toán không hợp lệ.';
  end if;
  expected_total:=payment_record.price_per_month*payment_record.months-payment_record.discount;
  if payment_record.total_amount<>expected_total then raise exception 'Tổng tiền không khớp giá, số tháng và giảm giá.'; end if;

  if lower(kiosk_record.status) in ('active','warning')
    and kiosk_record.end_date is not null and kiosk_record.end_date>=confirmation_date then
    effective_start_date:=kiosk_record.end_date+1;
  else
    effective_start_date:=confirmation_date;
  end if;
  calculated_end_date:=(effective_start_date+pg_catalog.make_interval(months=>payment_record.months)-interval '1 day')::date;

  perform pg_catalog.set_config('app.payment_workflow_action','confirm',true);
  update public.payments set payment_status='completed',confirmed_by=null,confirmed_at=confirmation_timestamp,
    start_date=effective_start_date,end_date=calculated_end_date
  where id=payment_record.id returning * into payment_record;
  update public.kiosks set status='active',start_date=effective_start_date,end_date=calculated_end_date where id=kiosk_record.id;
  update public.customers set status=case when lower(coalesce(status,''))='pending' then 'active' else status end,
    total_kiosks=(select count(*) from public.kiosks k where k.customer_id=customer_record.id)
  where id=customer_record.id;
  perform private.write_ttc_audit('Payment','confirm_payos','payments',payment_record.id::text,to_jsonb(before_record),to_jsonb(payment_record),reason_input);
  return jsonb_build_object('payment',to_jsonb(payment_record),'kiosk',(select to_jsonb(k) from public.kiosks k where k.id=kiosk_record.id),'customer',(select to_jsonb(c) from public.customers c where c.id=customer_record.id));
end;$function$;

-- Registration requests use the same inclusive calendar rule at creation and
-- are synchronized again from the authoritative completed payment.
create or replace function private.normalize_registration_requested_period()
returns trigger language plpgsql security definer set search_path='' as $function$
begin
  if new.requested_start_date is not null and new.months is not null and new.months>0 then
    new.requested_end_date:=(new.requested_start_date+pg_catalog.make_interval(months=>new.months)-interval '1 day')::date;
  end if;
  return new;
end;$function$;
drop trigger if exists normalize_registration_requested_period_trigger on public.registration_requests;
create trigger normalize_registration_requested_period_trigger before insert or update of requested_start_date,requested_end_date,months
on public.registration_requests for each row execute function private.normalize_registration_requested_period();

create or replace function private.sync_registration_period_from_completed_payment()
returns trigger language plpgsql security definer set search_path='' as $function$
begin
  if old.payment_status='pending' and new.payment_status='completed'
    and new.start_date is not null and new.end_date is not null then
    update public.registration_requests set requested_start_date=new.start_date,requested_end_date=new.end_date,updated_at=pg_catalog.now()
    where payment_id=new.id;
  end if;
  return new;
end;$function$;
drop trigger if exists sync_registration_period_from_completed_payment_trigger on public.payments;
create trigger sync_registration_period_from_completed_payment_trigger after update of payment_status,start_date,end_date
on public.payments for each row execute function private.sync_registration_period_from_completed_payment();

-- Distinguish a retry for the same paid order from a genuinely late paid
-- sibling. Both are idempotent; only the latter is flagged for reconciliation.
create or replace function public.handle_payos_webhook(order_code_input bigint,amount_input numeric,payment_link_id_input text default null,reference_input text default null,provider_payload_input jsonb default '{}'::jsonb,signature_input text default null,event_key_input text default null)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare order_record public.payos_orders%rowtype; payment_record public.payments%rowtype; event_record public.payos_webhook_events%rowtype; rpc_result jsonb;
declare normalized_event_key text:=coalesce(nullif(trim(event_key_input),''),'payos:'||order_code_input::text||':'||coalesce(nullif(trim(reference_input),''),'paid'));
begin
  insert into public.payos_webhook_events(event_key,order_code,signature,payload) values(normalized_event_key,order_code_input,nullif(trim(signature_input),''),coalesce(provider_payload_input,'{}'::jsonb))
  on conflict(event_key) do update set payload=excluded.payload returning * into event_record;
  if event_record.status='processed' then return jsonb_build_object('already_processed',true,'event',to_jsonb(event_record)); end if;
  select * into order_record from public.payos_orders where order_code=order_code_input for update;
  if not found then raise exception 'Không tìm thấy PayOS order.' using errcode='P0002'; end if;
  if order_record.amount<>amount_input then raise exception 'Số tiền webhook không khớp PayOS order.' using errcode='22023'; end if;
  if order_record.status='paid' then
    update public.payos_webhook_events set status='processed',processed_at=pg_catalog.now() where id=event_record.id returning * into event_record;
    return jsonb_build_object('already_processed',true,'order',to_jsonb(order_record),'event',to_jsonb(event_record));
  end if;
  if order_record.purpose='crm_payment' then
    select * into payment_record from public.payments where id=order_record.payment_id for update;
    if not found or payment_record.total_amount<>amount_input then raise exception 'Số tiền webhook không khớp thanh toán.' using errcode='22023'; end if;
    if payment_record.payment_status='completed' then
      update public.payos_orders set status='paid',active_slot=null,confirmed_at=coalesce(confirmed_at,pg_catalog.now()),processed_at=coalesce(processed_at,pg_catalog.now()),provider_payload=provider_payload||coalesce(provider_payload_input,'{}'::jsonb),updated_at=pg_catalog.now() where id=order_record.id returning * into order_record;
      update public.payos_webhook_events set status='processed',processed_at=pg_catalog.now(),error='Payment already completed; paid sibling requires reconciliation.' where id=event_record.id returning * into event_record;
      return jsonb_build_object('already_processed',true,'reconciliation_required',true,'order',to_jsonb(order_record),'event',to_jsonb(event_record));
    end if;
    if payment_record.payment_status<>'pending' then raise exception 'Thanh toán không còn ở trạng thái có thể hoàn tất.' using errcode='22023'; end if;
    rpc_result:=private.confirm_crm_payment_from_payos(payment_record.id,'PayOS paid: '||coalesce(nullif(trim(reference_input),''),order_record.order_code::text));
    update public.registration_requests set status='approved',reviewed_at=coalesce(reviewed_at,pg_catalog.now()),updated_at=pg_catalog.now() where payment_id=payment_record.id and status='pending';
    update public.payos_orders set status='cancelled',active_slot=null,processed_at=coalesce(processed_at,pg_catalog.now()),updated_at=pg_catalog.now() where payment_id=payment_record.id and id<>order_record.id and status='pending';
  elsif order_record.purpose='wallet_topup' then
    rpc_result:=private.post_wallet_ledger(order_record.wallet_user_id,order_record.amount,'admin_adjustment','payos_orders',order_record.id::text,'payos-paid:'||order_record.order_code::text,'Nạp xu PayOS','PayOS paid: '||coalesce(nullif(trim(reference_input),''),order_record.order_code::text),jsonb_build_object('source','payos','order_code',order_record.order_code),null,'system');
  else raise exception 'Mục đích PayOS không hợp lệ.' using errcode='22023'; end if;
  update public.payos_orders set status='paid',active_slot=null,payment_link_id=coalesce(nullif(trim(payment_link_id_input),''),payment_link_id),provider_payload=provider_payload||coalesce(provider_payload_input,'{}'::jsonb),confirmed_at=coalesce(confirmed_at,pg_catalog.now()),processed_at=pg_catalog.now(),updated_at=pg_catalog.now() where id=order_record.id returning * into order_record;
  update public.payos_webhook_events set status='processed',processed_at=pg_catalog.now() where id=event_record.id returning * into event_record;
  return jsonb_build_object('order',to_jsonb(order_record),'event',to_jsonb(event_record),'result',rpc_result,'already_processed',false);
end;$function$;
revoke all on function public.handle_payos_webhook(bigint,numeric,text,text,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.handle_payos_webhook(bigint,numeric,text,text,jsonb,text,text) to service_role;

-- Admin PayOS renewal preparation is also an idempotent business-intent
-- operation. Manual renewal continues to use admin_manual_renew_kiosk and
-- never calls this function or creates a PayOS order.
create or replace function public.create_renewal_payment(kiosk_id_input bigint,months_input integer,discount_input numeric default 0,discount_reason_input text default null,note_input text default null)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare actor public.user_roles%rowtype; kiosk_record public.kiosks%rowtype; package_record public.business_types%rowtype; payment_record public.payments%rowtype;
declare normalized_discount numeric:=coalesce(discount_input,0); calculated_total numeric; intent_key text; reused_value boolean:=false;
begin
  actor:=private.assert_payment_permission();
  if months_input is null or months_input<1 then raise exception 'Số tháng phải là số nguyên lớn hơn 0.' using errcode='22023'; end if;
  if normalized_discount<0 then raise exception 'Giảm giá không hợp lệ.' using errcode='22023'; end if;
  select * into kiosk_record from public.kiosks where id=kiosk_id_input for update;
  if not found then raise exception 'Không tìm thấy Kiosk.' using errcode='P0002'; end if;
  if kiosk_record.customer_id is null then raise exception 'Kiosk thiếu khách hàng.' using errcode='22023'; end if;
  select * into package_record from public.business_types where id=kiosk_record.business_type_id and is_active=true;
  if not found or package_record.price_per_month is null or package_record.price_per_month<0 then raise exception 'Gói dịch vụ không hợp lệ.' using errcode='22023'; end if;
  calculated_total:=package_record.price_per_month*months_input-normalized_discount;
  if calculated_total<0 then raise exception 'Giảm giá không được lớn hơn tạm tính.' using errcode='22023'; end if;
  if normalized_discount>0 and nullif(trim(discount_reason_input),'') is null then raise exception 'Lý do giảm giá là bắt buộc khi có giảm giá.' using errcode='22023'; end if;
  intent_key:='admin-renewal:'||kiosk_id_input::text||':'||months_input::text||':'||normalized_discount::text;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(intent_key,0));
  select * into payment_record from public.payments where payment_intent_key=intent_key and payment_status='pending' order by id desc limit 1 for update;
  if found then reused_value:=true; end if;
  if not found then
    select * into payment_record from public.payments
    where kiosk_id=kiosk_id_input and payment_status='pending' and transaction_type='standard'
      and start_date is null and end_date is null and months=months_input and discount=normalized_discount
      and total_amount=calculated_total and registration_request_id is null
      and coalesce(note,'')<>'Public PayOS Kiosk renewal'
    order by id desc limit 1 for update;
    if found then reused_value:=true; update public.payments set payment_intent_key=intent_key where id=payment_record.id returning * into payment_record; end if;
  end if;
  if not found then
    insert into public.payments(customer_id,kiosk_id,start_date,end_date,months,price_per_month,discount,discount_reason,total_amount,payment_method,payment_status,note,transaction_type,service_month_delta,payment_intent_key)
    values(kiosk_record.customer_id,kiosk_record.id,null,null,months_input,package_record.price_per_month,normalized_discount,nullif(trim(discount_reason_input),''),calculated_total,'transfer','pending',nullif(trim(note_input),''),'standard',0,intent_key)
    returning * into payment_record;
    perform private.write_payment_audit('create_renewal',null,to_jsonb(payment_record),'Tạo yêu cầu gia hạn PayOS',actor);
  end if;
  return jsonb_build_object('payment',to_jsonb(payment_record),'package',jsonb_build_object('id',package_record.id,'name',package_record.name,'pricePerMonth',package_record.price_per_month),'reused',reused_value);
end;$function$;
revoke all on function public.create_renewal_payment(bigint,integer,numeric,text,text) from public,anon,authenticated;
grant execute on function public.create_renewal_payment(bigint,integer,numeric,text,text) to authenticated;
