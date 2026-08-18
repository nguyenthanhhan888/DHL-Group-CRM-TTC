-- End-to-end PayOS intent hardening. This migration deliberately leaves
-- historical duplicate rows untouched; constraints apply to newly linked
-- intents/orders so production reconciliation remains a manual decision.

alter table public.payments add column if not exists registration_request_id bigint references public.registration_requests(id) on delete restrict;
alter table public.payments add column if not exists payment_intent_key text;
alter table public.payos_orders add column if not exists expires_at timestamptz;
alter table public.payos_orders add column if not exists active_slot boolean;
alter table public.payos_orders add column if not exists superseded_by_order_id bigint references public.payos_orders(id) on delete set null;

create unique index if not exists payments_registration_request_intent_uidx
  on public.payments(registration_request_id)
  where registration_request_id is not null;
create unique index if not exists payments_pending_intent_key_uidx
  on public.payments(payment_intent_key)
  where payment_intent_key is not null and payment_status = 'pending';
create unique index if not exists payos_orders_one_active_payment_uidx
  on public.payos_orders(payment_id)
  where purpose = 'crm_payment' and status = 'pending' and active_slot is true;

create index if not exists payos_orders_payment_expiry_idx
  on public.payos_orders(payment_id, expires_at desc);

create or replace function private.claim_payos_active_slot()
returns trigger language plpgsql security definer set search_path='' as $function$
begin
  if new.purpose<>'crm_payment' then return new; end if;
  begin new.expires_at:=coalesce(new.expires_at,to_timestamp((new.provider_payload->>'expiresAt')::bigint)); exception when others then null; end;
  update public.payos_orders set status='expired',active_slot=null,processed_at=coalesce(processed_at,now()),updated_at=now()
  where payment_id=new.payment_id and purpose='crm_payment' and status='pending' and active_slot is true
    and expires_at is not null and expires_at<=now();
  new.active_slot:=true;
  return new;
end;$function$;
drop trigger if exists claim_payos_active_slot_trigger on public.payos_orders;
create trigger claim_payos_active_slot_trigger before insert on public.payos_orders
for each row execute function private.claim_payos_active_slot();

-- Block a second public request for the same pending kiosk identity. Existing
-- historical duplicates are not changed by this trigger.
create or replace function private.prevent_duplicate_pending_registration()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare identity_key text;
begin
  identity_key := coalesce(
    nullif(regexp_replace(coalesce(new.facebook_id, ''), '[^0-9]', '', 'g'), ''),
    lower(regexp_replace(coalesce(new.facebook_link, ''), '[?#].*$', ''))
  );
  if identity_key is null or identity_key = '' then return new; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('registration:' || identity_key, 0));
  if exists (
    select 1 from public.registration_requests r
    where r.status = 'pending'
      and r.id <> coalesce(new.id, 0)
      and coalesce(
        nullif(regexp_replace(coalesce(r.facebook_id, ''), '[^0-9]', '', 'g'), ''),
        lower(regexp_replace(coalesce(r.facebook_link, ''), '[?#].*$', ''))
      ) = identity_key
  ) then
    raise exception 'Kiosk này đã có yêu cầu đăng ký đang chờ thanh toán.' using errcode = '23505';
  end if;
  return new;
end;$function$;
drop trigger if exists prevent_duplicate_pending_registration_trigger on public.registration_requests;
create trigger prevent_duplicate_pending_registration_trigger before insert or update of facebook_id, facebook_link, status
on public.registration_requests for each row execute function private.prevent_duplicate_pending_registration();

-- Deterministically link a registration request to its one business payment.
create or replace function private.sync_registration_payment_intent()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
  if new.payment_id is not null and (tg_op = 'INSERT' or old.payment_id is distinct from new.payment_id) then
    update public.payments
    set registration_request_id = new.id,
        payment_intent_key = 'registration:' || new.id::text
    where id = new.payment_id
      and (registration_request_id is null or registration_request_id = new.id);
  end if;
  return new;
end;$function$;
drop trigger if exists sync_registration_payment_intent_trigger on public.registration_requests;
create trigger sync_registration_payment_intent_trigger after insert or update of payment_id
on public.registration_requests for each row execute function private.sync_registration_payment_intent();

-- Public renewal preparation reuses the same pending business intent. A new
-- lookup token authorizes access but does not create a new financial liability.
create or replace function public.prepare_public_kiosk_renewal(kiosk_id_input bigint, months_input integer, nonce_hash_input text)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare kiosk_record public.kiosks%rowtype; package_record public.business_types%rowtype; payment_record public.payments%rowtype;
declare intent_key text := 'public-renewal:' || kiosk_id_input::text || ':' || months_input::text;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then raise exception 'Chỉ API server được chuẩn bị gia hạn công khai.' using errcode='42501'; end if;
  if months_input not in (1,3,6,12) then raise exception 'Thời hạn gia hạn không được hỗ trợ.' using errcode='22023'; end if;
  update private.public_renewal_authorizations set consumed_at=now()
  where nonce_hash=nonce_hash_input and kiosk_id=kiosk_id_input and consumed_at is null and expires_at>now();
  if not found then raise exception 'Quyền gia hạn đã hết hạn hoặc đã được sử dụng.' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(intent_key, 0));
  select * into kiosk_record from public.kiosks where id=kiosk_id_input for update;
  if not found or kiosk_record.customer_id is null then raise exception 'Không tìm thấy Kiosk hợp lệ.' using errcode='P0002'; end if;
  select * into package_record from public.business_types where id=kiosk_record.business_type_id and is_active=true;
  if not found or package_record.price_per_month is null or package_record.price_per_month<=0 then raise exception 'Giá dịch vụ hiện tại không hợp lệ.' using errcode='22023'; end if;
  select * into payment_record from public.payments
  where payment_intent_key=intent_key and payment_status='pending' order by id desc limit 1 for update;
  if found then
    if payment_record.total_amount <> package_record.price_per_month*months_input then
      raise exception 'Giá của ý định gia hạn hiện tại không còn hợp lệ; vui lòng liên hệ Admin.' using errcode='22023';
    end if;
  else
    insert into public.payments(customer_id,kiosk_id,months,price_per_month,discount,total_amount,payment_method,payment_status,note,transaction_type,service_month_delta,payment_intent_key)
    values(kiosk_record.customer_id,kiosk_record.id,months_input,package_record.price_per_month,0,package_record.price_per_month*months_input,'transfer','pending','Public PayOS Kiosk renewal','standard',0,intent_key)
    returning * into payment_record;
  end if;
  return jsonb_build_object('payment',to_jsonb(payment_record),'kiosk_name',kiosk_record.facebook_name,'business_type',package_record.name);
end;$function$;
revoke all on function public.prepare_public_kiosk_renewal(bigint,integer,text) from public,anon,authenticated;
grant execute on function public.prepare_public_kiosk_renewal(bigint,integer,text) to service_role;

-- Both server-side checkout paths reserve one active order. A replacement
-- closes the old database order before the new order becomes payable.
create or replace function private.reserve_crm_payos_order(
  payment_id_input bigint, order_code_input bigint, amount_input numeric, description_input text,
  checkout_url_input text, qr_code_input text, payment_link_id_input text, provider_payload_input jsonb
) returns public.payos_orders language plpgsql security definer set search_path='' as $function$
declare payment_record public.payments%rowtype; order_record public.payos_orders%rowtype; old_order public.payos_orders%rowtype;
declare expiry timestamptz;
begin
  select * into payment_record from public.payments where id=payment_id_input for update;
  if not found or payment_record.payment_status<>'pending' or payment_record.total_amount<>amount_input then raise exception 'Thanh toán Pending không hợp lệ.' using errcode='22023'; end if;
  begin expiry := to_timestamp((provider_payload_input->>'expiresAt')::bigint); exception when others then expiry := null; end;
  select * into old_order from public.payos_orders where payment_id=payment_id_input and purpose='crm_payment' and status='pending' and active_slot is true order by id desc limit 1 for update;
  if found and old_order.order_code<>order_code_input then
    if old_order.expires_at is null or old_order.expires_at>now() then raise exception 'Thanh toán đã có một mã PayOS còn hiệu lực.' using errcode='23505'; end if;
    update public.payos_orders set status='expired',active_slot=null,processed_at=coalesce(processed_at,now()),updated_at=now() where id=old_order.id;
  end if;
  insert into public.payos_orders(order_code,purpose,payment_id,amount,description,checkout_url,qr_code,payment_link_id,provider_payload,created_by,expires_at,active_slot)
  values(order_code_input,'crm_payment',payment_id_input,amount_input,nullif(trim(description_input),''),nullif(trim(checkout_url_input),''),nullif(trim(qr_code_input),''),nullif(trim(payment_link_id_input),''),coalesce(provider_payload_input,'{}'::jsonb),auth.uid(),expiry,true)
  on conflict(order_code) do update set checkout_url=excluded.checkout_url,qr_code=excluded.qr_code,payment_link_id=excluded.payment_link_id,
    provider_payload=excluded.provider_payload,expires_at=coalesce(excluded.expires_at,public.payos_orders.expires_at),updated_at=now()
  where public.payos_orders.status='pending' returning * into order_record;
  if old_order.id is not null and old_order.id<>order_record.id then update public.payos_orders set superseded_by_order_id=order_record.id where id=old_order.id; end if;
  return order_record;
end;$function$;

create or replace function public.record_public_renewal_payos_order(payment_id_input bigint,order_code_input bigint,amount_input numeric,description_input text,checkout_url_input text default null,qr_code_input text default null,payment_link_id_input text default null,provider_payload_input jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare order_record public.payos_orders%rowtype;
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Chỉ API server được ghi PayOS order.' using errcode='42501'; end if;
  if not exists(select 1 from public.payments where id=payment_id_input and note='Public PayOS Kiosk renewal') then raise exception 'Thanh toán gia hạn không hợp lệ.' using errcode='22023'; end if;
  order_record := private.reserve_crm_payos_order(payment_id_input,order_code_input,amount_input,description_input,checkout_url_input,qr_code_input,payment_link_id_input,provider_payload_input);
  return to_jsonb(order_record);
end;$function$;
revoke all on function public.record_public_renewal_payos_order(bigint,bigint,numeric,text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.record_public_renewal_payos_order(bigint,bigint,numeric,text,text,text,text,jsonb) to service_role;

-- Finalization locks the business payment, accepts a valid late payment on an
-- old order, and closes every sibling without applying service twice.
create or replace function public.handle_payos_webhook(order_code_input bigint,amount_input numeric,payment_link_id_input text default null,reference_input text default null,provider_payload_input jsonb default '{}'::jsonb,signature_input text default null,event_key_input text default null)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare order_record public.payos_orders%rowtype; sibling public.payos_orders%rowtype; payment_record public.payments%rowtype; event_record public.payos_webhook_events%rowtype; rpc_result jsonb;
declare normalized_event_key text:=coalesce(nullif(trim(event_key_input),''),'payos:'||order_code_input::text||':'||coalesce(nullif(trim(reference_input),''),'paid'));
begin
  insert into public.payos_webhook_events(event_key,order_code,signature,payload) values(normalized_event_key,order_code_input,nullif(trim(signature_input),''),coalesce(provider_payload_input,'{}'::jsonb))
  on conflict(event_key) do update set payload=excluded.payload returning * into event_record;
  if event_record.status='processed' then return jsonb_build_object('already_processed',true,'event',to_jsonb(event_record)); end if;
  select * into order_record from public.payos_orders where order_code=order_code_input for update;
  if not found then raise exception 'Không tìm thấy PayOS order.' using errcode='P0002'; end if;
  if order_record.amount<>amount_input then raise exception 'Số tiền webhook không khớp PayOS order.' using errcode='22023'; end if;
  if order_record.purpose='crm_payment' then
    select * into payment_record from public.payments where id=order_record.payment_id for update;
    if not found or payment_record.total_amount<>amount_input then raise exception 'Số tiền webhook không khớp thanh toán.' using errcode='22023'; end if;
    if payment_record.payment_status='completed' then
      update public.payos_orders set status='paid',active_slot=null,confirmed_at=coalesce(confirmed_at,now()),processed_at=coalesce(processed_at,now()),provider_payload=provider_payload||coalesce(provider_payload_input,'{}'::jsonb),updated_at=now() where id=order_record.id returning * into order_record;
      update public.payos_webhook_events set status='processed',processed_at=now(),error='Payment already completed; paid sibling requires reconciliation.' where id=event_record.id returning * into event_record;
      return jsonb_build_object('already_processed',true,'reconciliation_required',true,'order',to_jsonb(order_record),'event',to_jsonb(event_record));
    end if;
    if payment_record.payment_status<>'pending' then raise exception 'Thanh toán không còn ở trạng thái có thể hoàn tất.' using errcode='22023'; end if;
    rpc_result:=private.confirm_crm_payment_from_payos(payment_record.id,'PayOS paid: '||coalesce(nullif(trim(reference_input),''),order_record.order_code::text));
    update public.registration_requests set status='approved',reviewed_at=coalesce(reviewed_at,now()),updated_at=now()
      where payment_id=payment_record.id and status='pending';
    update public.payos_orders set status='cancelled',active_slot=null,processed_at=coalesce(processed_at,now()),updated_at=now()
      where payment_id=payment_record.id and id<>order_record.id and status='pending';
  elsif order_record.purpose='wallet_topup' then
    if order_record.status='paid' then return jsonb_build_object('already_processed',true,'order',to_jsonb(order_record)); end if;
    rpc_result:=private.post_wallet_ledger(order_record.wallet_user_id,order_record.amount,'admin_adjustment','payos_orders',order_record.id::text,'payos-paid:'||order_record.order_code::text,'Nạp xu PayOS','PayOS paid: '||coalesce(nullif(trim(reference_input),''),order_record.order_code::text),jsonb_build_object('source','payos','order_code',order_record.order_code),null,'system');
  else raise exception 'Mục đích PayOS không hợp lệ.' using errcode='22023'; end if;
  update public.payos_orders set status='paid',active_slot=null,payment_link_id=coalesce(nullif(trim(payment_link_id_input),''),payment_link_id),provider_payload=provider_payload||coalesce(provider_payload_input,'{}'::jsonb),confirmed_at=coalesce(confirmed_at,now()),processed_at=now(),updated_at=now() where id=order_record.id returning * into order_record;
  update public.payos_webhook_events set status='processed',processed_at=now() where id=event_record.id returning * into event_record;
  return jsonb_build_object('order',to_jsonb(order_record),'event',to_jsonb(event_record),'result',rpc_result,'already_processed',false);
end;$function$;
revoke all on function public.handle_payos_webhook(bigint,numeric,text,text,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.handle_payos_webhook(bigint,numeric,text,text,jsonb,text,text) to service_role;

create or replace function public.record_registration_payos_order(payment_id_input bigint,order_code_input bigint,amount_input numeric,description_input text,checkout_url_input text default null,qr_code_input text default null,payment_link_id_input text default null,provider_payload_input jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare order_record public.payos_orders%rowtype;
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Chỉ API server được ghi PayOS order đăng ký.' using errcode='42501'; end if;
  if not exists(select 1 from public.payments p join public.registration_requests r on r.payment_id=p.id where p.id=payment_id_input and p.payment_status='pending') then raise exception 'Thanh toán đăng ký không hợp lệ.' using errcode='22023'; end if;
  order_record:=private.reserve_crm_payos_order(payment_id_input,order_code_input,amount_input,description_input,checkout_url_input,qr_code_input,payment_link_id_input,provider_payload_input);
  return to_jsonb(order_record);
end;$function$;
revoke all on function public.record_registration_payos_order(bigint,bigint,numeric,text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.record_registration_payos_order(bigint,bigint,numeric,text,text,text,text,jsonb) to service_role;
