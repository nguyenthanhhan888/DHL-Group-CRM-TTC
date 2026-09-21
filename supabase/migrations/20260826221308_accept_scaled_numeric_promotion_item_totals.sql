-- PostgreSQL numeric values retain their scale when embedded in jsonb. For
-- example, a NUMERIC price of 2000.00 is extracted with ->> as the text
-- "2000.00", which cannot be cast directly to bigint. Accept numeric text at
-- the promotion evaluator boundary before converting to the existing integer
-- VND contract.
create or replace function private.evaluate_registration_promotion(
  promotion_code_input text,
  customer_id_input bigint,
  items_input jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  normalized_code text := pg_catalog.upper(pg_catalog.btrim(coalesce(promotion_code_input, '')));
  promotion_record public.promotions%rowtype;
  item jsonb;
  subtotal bigint := 0;
  eligible_total bigint := 0;
  discount_total bigint := 0;
  kiosk_count integer := 0;
  total_bonus integer := 0;
  eligible boolean;
  item_total bigint;
  item_months integer;
  evaluated_items jsonb := '[]'::jsonb;
begin
  if pg_catalog.jsonb_typeof(items_input) <> 'array' then
    raise exception 'Danh sách Kiosk không hợp lệ.' using errcode = '22023';
  end if;

  for item in select value from pg_catalog.jsonb_array_elements(items_input) loop
    item_total := coalesce((item->>'totalAmount')::numeric::bigint, 0);
    if item_total < 0 then
      raise exception 'Giá trị Kiosk không hợp lệ.' using errcode = '22023';
    end if;
    subtotal := subtotal + item_total;
    kiosk_count := kiosk_count + 1;
  end loop;

  if normalized_code = '' then
    return pg_catalog.jsonb_build_object(
      'valid', true,
      'code', null,
      'subtotal', subtotal,
      'eligibleSubtotal', 0,
      'discountAmount', 0,
      'finalAmount', subtotal,
      'items', items_input,
      'message', ''
    );
  end if;

  select * into promotion_record
  from public.promotions
  where code = normalized_code;

  if not found then
    return pg_catalog.jsonb_build_object('valid', false, 'code', normalized_code, 'message', 'Mã giảm giá không tồn tại.');
  end if;
  if not promotion_record.is_active then
    return pg_catalog.jsonb_build_object('valid', false, 'code', normalized_code, 'message', 'Mã giảm giá đang tạm ngưng.');
  end if;
  if promotion_record.starts_at is not null and pg_catalog.now() < promotion_record.starts_at then
    return pg_catalog.jsonb_build_object('valid', false, 'code', normalized_code, 'message', 'Mã này chưa bắt đầu.');
  end if;
  if promotion_record.ends_at is not null and pg_catalog.now() > promotion_record.ends_at then
    return pg_catalog.jsonb_build_object('valid', false, 'code', normalized_code, 'message', 'Mã giảm giá đã hết hạn.');
  end if;
  if promotion_record.minimum_order_amount is not null and subtotal < promotion_record.minimum_order_amount then
    return pg_catalog.jsonb_build_object('valid', false, 'code', normalized_code, 'message', 'Đơn hàng chưa đạt giá trị tối thiểu.');
  end if;
  if promotion_record.minimum_kiosk_count is not null and kiosk_count < promotion_record.minimum_kiosk_count then
    return pg_catalog.jsonb_build_object('valid', false, 'code', normalized_code, 'message', 'Mã này yêu cầu đăng ký ít nhất ' || promotion_record.minimum_kiosk_count || ' Kiosk.');
  end if;
  if promotion_record.usage_limit_total is not null
    and (select pg_catalog.count(*) from public.promotion_usages u where u.promotion_id = promotion_record.id) >= promotion_record.usage_limit_total then
    return pg_catalog.jsonb_build_object('valid', false, 'code', normalized_code, 'message', 'Mã đã hết lượt sử dụng.');
  end if;
  if customer_id_input is not null
    and promotion_record.usage_limit_per_customer is not null
    and (
      select pg_catalog.count(*)
      from public.promotion_usages u
      where u.promotion_id = promotion_record.id
        and u.customer_id = customer_id_input
    ) >= promotion_record.usage_limit_per_customer then
    return pg_catalog.jsonb_build_object('valid', false, 'code', normalized_code, 'message', 'Bạn đã sử dụng hết số lượt của mã này.');
  end if;

  for item in select value from pg_catalog.jsonb_array_elements(items_input) loop
    item_total := coalesce((item->>'totalAmount')::numeric::bigint, 0);
    item_months := coalesce((item->>'months')::integer, 0);
    eligible := (promotion_record.minimum_months is null or item_months >= promotion_record.minimum_months)
      and (
        promotion_record.scope_type = 'all'
        or (
          promotion_record.scope_type = 'category'
          and exists (
            select 1 from public.promotion_categories s
            where s.promotion_id = promotion_record.id
              and s.category_id = (item->>'categoryId')::bigint
          )
        )
        or (
          promotion_record.scope_type = 'business_type'
          and exists (
            select 1 from public.promotion_business_types s
            where s.promotion_id = promotion_record.id
              and s.business_type_id = (item->>'businessTypeId')::bigint
          )
        )
      );
    if eligible then
      eligible_total := eligible_total + item_total;
    end if;
    evaluated_items := evaluated_items || pg_catalog.jsonb_build_array(
      item || pg_catalog.jsonb_build_object(
        'eligible', eligible,
        'bonusMonths', case when eligible and promotion_record.discount_type = 'bonus_months' then promotion_record.discount_value else 0 end,
        'effectiveMonths', item_months + case when eligible and promotion_record.discount_type = 'bonus_months' then promotion_record.discount_value else 0 end
      )
    );
    if eligible and promotion_record.discount_type = 'bonus_months' then
      total_bonus := total_bonus + promotion_record.discount_value;
    end if;
  end loop;

  if eligible_total = 0 then
    return pg_catalog.jsonb_build_object('valid', false, 'code', normalized_code, 'message', 'Mã chỉ áp dụng cho một số ngành nghề hoặc thời hạn đăng ký.');
  end if;
  if promotion_record.discount_type = 'percentage' then
    discount_total := pg_catalog.floor(eligible_total * promotion_record.discount_value / 100.0)::bigint;
    if promotion_record.max_discount_amount is not null then
      discount_total := least(discount_total, promotion_record.max_discount_amount);
    end if;
  elsif promotion_record.discount_type = 'fixed_amount' then
    discount_total := least(eligible_total, promotion_record.discount_value);
  end if;
  if subtotal - discount_total <= 0 then
    return pg_catalog.jsonb_build_object('valid', false, 'code', normalized_code, 'message', 'Mã làm tổng thanh toán bằng 0 và chưa được hỗ trợ.');
  end if;

  return pg_catalog.jsonb_build_object(
    'valid', true,
    'code', normalized_code,
    'promotionId', promotion_record.id,
    'discountType', promotion_record.discount_type,
    'discountValue', promotion_record.discount_value,
    'subtotal', subtotal,
    'eligibleSubtotal', eligible_total,
    'discountAmount', discount_total,
    'finalAmount', subtotal - discount_total,
    'totalBonusMonths', total_bonus,
    'items', evaluated_items,
    'message', 'Áp dụng mã ' || normalized_code || ' thành công.'
  );
end;
$function$;
revoke all on function private.evaluate_registration_promotion(text, bigint, jsonb)
  from public, anon, authenticated, service_role;
