-- The promotion migration exposed two overloads where the three-argument
-- version also defaulted its final argument. Its internal two-argument call
-- was therefore ambiguous at runtime. Keep the original implementation as a
-- private helper and expose one unambiguous Data API function.
alter function public.prepare_registration_batch_for_payos(bigint[], text)
  set schema private;

revoke all on function private.prepare_registration_batch_for_payos(bigint[], text)
  from public, anon, authenticated;
grant execute on function private.prepare_registration_batch_for_payos(bigint[], text)
  to service_role;

-- PostgreSQL cannot remove an existing argument default with CREATE OR
-- REPLACE. Drop both exact public identities after preserving the base body,
-- then recreate the only supported Data API signature without a default.
drop function if exists public.prepare_registration_batch_for_payos(bigint[], text);
drop function if exists public.prepare_registration_batch_for_payos(bigint[], text, text);

create function public.prepare_registration_batch_for_payos(
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
  result jsonb;
  batch_record public.registration_batches%rowtype;
  evaluation jsonb;
  items jsonb;
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then
    raise exception 'Chỉ API server được chuẩn bị thanh toán đăng ký.' using errcode = '42501';
  end if;

  result := private.prepare_registration_batch_for_payos(request_ids_input, phone_input);

  select * into batch_record
  from public.registration_batches
  where id = (result->'batch'->>'id')::bigint
  for update;

  if batch_record.promotion_snapshot is not null then
    if coalesce(batch_record.promotion_code, '') <> pg_catalog.upper(pg_catalog.btrim(coalesce(promotion_code_input, ''))) then
      raise exception 'Mã ưu đãi của lô thanh toán đã được khóa.' using errcode = '22023';
    end if;
    return result || jsonb_build_object('promotion', batch_record.promotion_snapshot, 'batch', to_jsonb(batch_record));
  end if;

  select jsonb_agg(jsonb_build_object(
      'itemId', i.id,
      'kioskId', i.kiosk_id,
      'months', i.months,
      'totalAmount', i.total_amount,
      'businessTypeId', i.business_type_id,
      'categoryId', b.category_id
    ) order by i.id)
  into items
  from public.registration_batch_items i
  join public.business_types b on b.id = i.business_type_id
  where i.batch_id = batch_record.id;

  evaluation := private.evaluate_registration_promotion(promotion_code_input, batch_record.customer_id, items);
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

  update public.payments
  set price_per_month = (evaluation->>'subtotal')::bigint,
      discount = (evaluation->>'discountAmount')::bigint,
      total_amount = (evaluation->>'finalAmount')::bigint
  where id = batch_record.payment_id;

  update public.registration_batch_items i
  set promotion_eligible = coalesce((x.value->>'eligible')::boolean, false),
      bonus_months = coalesce((x.value->>'bonusMonths')::integer, 0),
      effective_service_months = coalesce((x.value->>'effectiveMonths')::integer, i.months)
  from jsonb_array_elements(evaluation->'items') x
  where i.id = (x.value->>'itemId')::bigint;

  if (evaluation->>'discountAmount')::bigint > 0 then
    with eligible_items as (
      select i.id, i.total_amount,
        pg_catalog.floor((evaluation->>'discountAmount')::numeric * i.total_amount / (evaluation->>'eligibleSubtotal')::numeric)::bigint as base_discount
      from public.registration_batch_items i
      where i.batch_id = batch_record.id and i.promotion_eligible
    ), ranked as (
      select e.*,
        row_number() over (order by e.id) as allocation_rank,
        (evaluation->>'discountAmount')::bigint - sum(e.base_discount) over () as remainder
      from eligible_items e
    )
    update public.registration_batch_items i
    set discount = r.base_discount + case when r.allocation_rank <= r.remainder then 1 else 0 end,
        total_amount = i.total_amount - (r.base_discount + case when r.allocation_rank <= r.remainder then 1 else 0 end)
    from ranked r
    where i.id = r.id;
  end if;

  return result || jsonb_build_object(
    'promotion', evaluation,
    'batch', to_jsonb(batch_record),
    'payment', (select to_jsonb(p) from public.payments p where p.id = batch_record.payment_id),
    'items', (select jsonb_agg(jsonb_build_object(
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
      ) order by i.id)
      from public.registration_batch_items i
      join public.kiosks k on k.id = i.kiosk_id
      where i.batch_id = batch_record.id)
  );
end;
$function$;

revoke all on function public.prepare_registration_batch_for_payos(bigint[], text, text)
  from public, anon, authenticated;
grant execute on function public.prepare_registration_batch_for_payos(bigint[], text, text)
  to service_role;
