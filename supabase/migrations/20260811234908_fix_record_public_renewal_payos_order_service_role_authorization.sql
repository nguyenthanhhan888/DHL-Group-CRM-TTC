-- Replace the final legacy request-role check in the public renewal flow while
-- preserving the PayOS order validation, payload, and response contract.

create or replace function public.record_public_renewal_payos_order(
  payment_id_input bigint,
  order_code_input bigint,
  amount_input numeric,
  description_input text,
  checkout_url_input text default null,
  qr_code_input text default null,
  payment_link_id_input text default null,
  provider_payload_input jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  payment_record public.payments%rowtype;
  order_record public.payos_orders%rowtype;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'Chỉ API server được ghi PayOS order.' using errcode = '42501';
  end if;

  select *
  into payment_record
  from public.payments
  where id = payment_id_input
    and payment_status = 'pending'
    and note = 'Public PayOS Kiosk renewal';

  if not found or payment_record.total_amount <> amount_input then
    raise exception 'Thanh toán gia hạn không hợp lệ.' using errcode = '22023';
  end if;

  insert into public.payos_orders(
    order_code,
    purpose,
    payment_id,
    amount,
    description,
    checkout_url,
    qr_code,
    payment_link_id,
    provider_payload,
    created_by
  ) values (
    order_code_input,
    'crm_payment',
    payment_id_input,
    amount_input,
    nullif(trim(description_input), ''),
    nullif(trim(checkout_url_input), ''),
    nullif(trim(qr_code_input), ''),
    nullif(trim(payment_link_id_input), ''),
    coalesce(provider_payload_input, '{}'::jsonb),
    null
  )
  on conflict (order_code) do update
  set checkout_url = excluded.checkout_url,
      qr_code = excluded.qr_code,
      payment_link_id = excluded.payment_link_id,
      provider_payload = excluded.provider_payload,
      updated_at = now()
  where public.payos_orders.status = 'pending'
  returning * into order_record;

  return to_jsonb(order_record);
end;
$function$;

revoke all on function public.record_public_renewal_payos_order(
  bigint, bigint, numeric, text, text, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.record_public_renewal_payos_order(
  bigint, bigint, numeric, text, text, text, text, jsonb
) to service_role;
