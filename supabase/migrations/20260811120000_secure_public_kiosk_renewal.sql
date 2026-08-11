-- Server-only preparation and PayOS order recording for public Kiosk renewal.
-- Browser clients receive a short-lived signed token; only the API server may
-- invoke these functions with the service-role JWT.

create table if not exists private.public_renewal_authorizations(nonce_hash text primary key,kiosk_id bigint not null references public.kiosks(id),expires_at timestamptz not null,consumed_at timestamptz);
revoke all on table private.public_renewal_authorizations from public,anon,authenticated;

create or replace function public.register_public_renewal_authorization(kiosk_id_input bigint,nonce_hash_input text,expires_at_input timestamptz)
returns void language plpgsql security definer set search_path='' as $function$
begin
 if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then raise exception 'Chỉ API server được cấp quyền gia hạn.' using errcode='42501'; end if;
 if expires_at_input<=now() or expires_at_input>now()+interval '15 minutes' then raise exception 'Hạn token không hợp lệ.' using errcode='22023'; end if;
 insert into private.public_renewal_authorizations(nonce_hash,kiosk_id,expires_at) values(nonce_hash_input,kiosk_id_input,expires_at_input);
end;$function$;

create or replace function public.prepare_public_kiosk_renewal(kiosk_id_input bigint, months_input integer, nonce_hash_input text)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  kiosk_record public.kiosks%rowtype;
  package_record public.business_types%rowtype;
  payment_record public.payments%rowtype;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'Chỉ API server được chuẩn bị gia hạn công khai.' using errcode = '42501';
  end if;
  if months_input not in (1, 3, 6, 12) then
    raise exception 'Thời hạn gia hạn không được hỗ trợ.' using errcode = '22023';
  end if;
  update private.public_renewal_authorizations set consumed_at=now() where nonce_hash=nonce_hash_input and kiosk_id=kiosk_id_input and consumed_at is null and expires_at>now();
  if not found then raise exception 'Quyền gia hạn đã hết hạn hoặc đã được sử dụng.' using errcode='42501'; end if;
  select * into kiosk_record from public.kiosks where id = kiosk_id_input for update;
  if not found or kiosk_record.customer_id is null then raise exception 'Không tìm thấy Kiosk hợp lệ.' using errcode = 'P0002'; end if;
  select * into package_record from public.business_types where id = kiosk_record.business_type_id and is_active = true;
  if not found or package_record.price_per_month is null or package_record.price_per_month <= 0 then raise exception 'Giá dịch vụ hiện tại không hợp lệ.' using errcode = '22023'; end if;
  insert into public.payments(customer_id,kiosk_id,months,price_per_month,discount,total_amount,payment_method,payment_status,note,transaction_type,service_month_delta)
  values(kiosk_record.customer_id,kiosk_record.id,months_input,package_record.price_per_month,0,package_record.price_per_month*months_input,'transfer','pending','Public PayOS Kiosk renewal','standard',0)
  returning * into payment_record;
  return jsonb_build_object('payment',to_jsonb(payment_record),'kiosk_name',kiosk_record.facebook_name,'business_type',package_record.name);
end;$function$;

create or replace function public.record_public_renewal_payos_order(
  payment_id_input bigint, order_code_input bigint, amount_input numeric, description_input text,
  checkout_url_input text default null, qr_code_input text default null,
  payment_link_id_input text default null, provider_payload_input jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $function$
declare payment_record public.payments%rowtype; order_record public.payos_orders%rowtype;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then raise exception 'Chỉ API server được ghi PayOS order.' using errcode='42501'; end if;
  select * into payment_record from public.payments where id=payment_id_input and payment_status='pending' and note='Public PayOS Kiosk renewal';
  if not found or payment_record.total_amount <> amount_input then raise exception 'Thanh toán gia hạn không hợp lệ.' using errcode='22023'; end if;
  insert into public.payos_orders(order_code,purpose,payment_id,amount,description,checkout_url,qr_code,payment_link_id,provider_payload,created_by)
  values(order_code_input,'crm_payment',payment_id_input,amount_input,nullif(trim(description_input),''),nullif(trim(checkout_url_input),''),nullif(trim(qr_code_input),''),nullif(trim(payment_link_id_input),''),coalesce(provider_payload_input,'{}'::jsonb),null)
  on conflict(order_code) do update set checkout_url=excluded.checkout_url,qr_code=excluded.qr_code,payment_link_id=excluded.payment_link_id,provider_payload=excluded.provider_payload,updated_at=now()
  where public.payos_orders.status='pending' returning * into order_record;
  return to_jsonb(order_record);
end;$function$;

revoke all on function public.register_public_renewal_authorization(bigint,text,timestamptz) from public,anon,authenticated;
revoke all on function public.prepare_public_kiosk_renewal(bigint,integer,text) from public,anon,authenticated;
revoke all on function public.record_public_renewal_payos_order(bigint,bigint,numeric,text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.register_public_renewal_authorization(bigint,text,timestamptz) to service_role;
grant execute on function public.prepare_public_kiosk_renewal(bigint,integer,text) to service_role;
grant execute on function public.record_public_renewal_payos_order(bigint,bigint,numeric,text,text,text,text,jsonb) to service_role;

create or replace function private.normalize_payos_renewal_period()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
  if old.payment_status='pending' and new.payment_status='completed' and new.transaction_type='standard'
    and old.start_date is null and old.end_date is null and new.start_date is not null and new.end_date is not null then
    new.end_date := new.end_date - 1;
  end if;
  return new;
end;$function$;
drop trigger if exists normalize_payos_renewal_period_trigger on public.payments;
create trigger normalize_payos_renewal_period_trigger before update on public.payments
for each row execute function private.normalize_payos_renewal_period();

create or replace function private.sync_completed_renewal_kiosk_period()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
  if new.payment_status='completed' and new.start_date is not null and new.end_date is not null then
    update public.kiosks set status='active',start_date=new.start_date,end_date=new.end_date where id=new.kiosk_id;
  end if;
  return null;
end;$function$;
drop trigger if exists sync_completed_renewal_kiosk_period_trigger on public.payments;
create constraint trigger sync_completed_renewal_kiosk_period_trigger after update on public.payments
deferrable initially deferred for each row execute function private.sync_completed_renewal_kiosk_period();
