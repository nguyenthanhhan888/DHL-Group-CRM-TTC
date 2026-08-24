-- Forward-only correction for SQLSTATE 42702 in the Admin promotion save RPC.
-- The original function used `id` as an unqualified SRF output/column name.

create or replace function public.admin_save_promotion(
  promotion_id_input bigint,
  promotion_input jsonb,
  category_ids_input bigint[] default '{}'::bigint[],
  business_type_ids_input bigint[] default '{}'::bigint[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  saved public.promotions%rowtype;
  scope_value text := coalesce(promotion_input->>'scope_type', 'all');
begin
  if not exists (
    select 1
    from public.user_roles as ur
    where ur.user_id = (select auth.uid())
      and pg_catalog.lower(ur.role) = 'admin'
      and ur.is_active
  ) then
    raise exception 'Bạn không có quyền quản lý mã giảm giá.' using errcode = '42501';
  end if;

  if scope_value = 'category'
    and coalesce(pg_catalog.array_length(category_ids_input, 1), 0) = 0 then
    raise exception 'Vui lòng chọn ít nhất một danh mục.' using errcode = '22023';
  end if;

  if scope_value = 'business_type'
    and coalesce(pg_catalog.array_length(business_type_ids_input, 1), 0) = 0 then
    raise exception 'Vui lòng chọn ít nhất một loại hình kinh doanh.' using errcode = '22023';
  end if;

  if scope_value = 'category' and exists (
    select 1
    from pg_catalog.unnest(category_ids_input) as category_scope(category_id)
    left join public.categories as c on c.id = category_scope.category_id
    where c.id is null
  ) then
    raise exception 'Danh mục áp dụng không hợp lệ.' using errcode = '22023';
  end if;

  if scope_value = 'business_type' and exists (
    select 1
    from pg_catalog.unnest(business_type_ids_input) as business_type_scope(business_type_id)
    left join public.business_types as bt on bt.id = business_type_scope.business_type_id
    where bt.id is null
  ) then
    raise exception 'Loại hình kinh doanh áp dụng không hợp lệ.' using errcode = '22023';
  end if;

  if promotion_id_input is null then
    insert into public.promotions as p (
      code, name, description, discount_type, discount_value,
      max_discount_amount, minimum_order_amount, minimum_kiosk_count,
      minimum_months, starts_at, ends_at, usage_limit_total,
      usage_limit_per_customer, scope_type, is_active, created_by
    ) values (
      promotion_input->>'code',
      promotion_input->>'name',
      promotion_input->>'description',
      promotion_input->>'discount_type',
      (promotion_input->>'discount_value')::bigint,
      nullif(promotion_input->>'max_discount_amount', '')::bigint,
      nullif(promotion_input->>'minimum_order_amount', '')::bigint,
      nullif(promotion_input->>'minimum_kiosk_count', '')::integer,
      nullif(promotion_input->>'minimum_months', '')::integer,
      nullif(promotion_input->>'starts_at', '')::timestamptz,
      nullif(promotion_input->>'ends_at', '')::timestamptz,
      nullif(promotion_input->>'usage_limit_total', '')::integer,
      nullif(promotion_input->>'usage_limit_per_customer', '')::integer,
      scope_value,
      coalesce((promotion_input->>'is_active')::boolean, true),
      (select auth.uid())
    ) returning p.* into saved;
  else
    update public.promotions as p
    set
      name = promotion_input->>'name',
      description = promotion_input->>'description',
      discount_type = promotion_input->>'discount_type',
      discount_value = (promotion_input->>'discount_value')::bigint,
      max_discount_amount = nullif(promotion_input->>'max_discount_amount', '')::bigint,
      minimum_order_amount = nullif(promotion_input->>'minimum_order_amount', '')::bigint,
      minimum_kiosk_count = nullif(promotion_input->>'minimum_kiosk_count', '')::integer,
      minimum_months = nullif(promotion_input->>'minimum_months', '')::integer,
      starts_at = nullif(promotion_input->>'starts_at', '')::timestamptz,
      ends_at = nullif(promotion_input->>'ends_at', '')::timestamptz,
      usage_limit_total = nullif(promotion_input->>'usage_limit_total', '')::integer,
      usage_limit_per_customer = nullif(promotion_input->>'usage_limit_per_customer', '')::integer,
      scope_type = scope_value
    where p.id = promotion_id_input
    returning p.* into saved;

    if not found then
      raise exception 'Không tìm thấy chương trình khuyến mãi.' using errcode = 'P0002';
    end if;
  end if;

  delete from public.promotion_categories as pc
  where pc.promotion_id = saved.id;

  delete from public.promotion_business_types as pbt
  where pbt.promotion_id = saved.id;

  if scope_value = 'category' then
    insert into public.promotion_categories (promotion_id, category_id)
    select distinct saved.id, category_scope.category_id
    from pg_catalog.unnest(category_ids_input) as category_scope(category_id);
  end if;

  if scope_value = 'business_type' then
    insert into public.promotion_business_types (promotion_id, business_type_id)
    select distinct saved.id, business_type_scope.business_type_id
    from pg_catalog.unnest(business_type_ids_input) as business_type_scope(business_type_id);
  end if;

  return to_jsonb(saved);
end;
$function$;

revoke all on function public.admin_save_promotion(bigint,jsonb,bigint[],bigint[])
from public, anon, authenticated;
grant execute on function public.admin_save_promotion(bigint,jsonb,bigint[],bigint[])
to authenticated;
