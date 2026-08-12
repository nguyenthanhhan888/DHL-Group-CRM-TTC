set local lock_timeout = '5s';
set local statement_timeout = '30s';

drop function if exists public.get_business_types_with_stats(text);
drop function if exists public.get_categories_with_stats();

alter table public.business_types drop column if exists sort_order;
alter table public.categories drop column if exists sort_order;

create function public.get_business_types_with_stats(search_term text)
returns table(
  id bigint,
  category_id bigint,
  name text,
  description text,
  price_per_month numeric,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz,
  category_name text,
  kiosk_count bigint
)
language sql
stable
set search_path = ''
as $function$
  select
    bt.id,
    bt.category_id,
    bt.name,
    bt.description,
    bt.price_per_month,
    bt.is_active,
    bt.created_at,
    bt.updated_at,
    c.name as category_name,
    coalesce(k.kiosk_count, 0) as kiosk_count
  from public.business_types bt
  left join public.categories c on bt.category_id = c.id
  left join (
    select business_type_id, count(*) as kiosk_count
    from public.kiosks
    where business_type_id is not null
    group by business_type_id
  ) k on bt.id = k.business_type_id
  where search_term is null
     or bt.name ilike ('%' || search_term || '%')
     or bt.description ilike ('%' || search_term || '%')
     or c.name ilike ('%' || search_term || '%');
$function$;

create function public.get_categories_with_stats()
returns table(
  id bigint,
  name text,
  description text,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz,
  kiosk_count bigint,
  customer_count bigint
)
language sql
stable
set search_path = ''
as $function$
  select
    c.id,
    c.name,
    c.description,
    c.is_active,
    c.created_at,
    c.updated_at,
    coalesce(k.kiosk_count, 0) as kiosk_count,
    coalesce(k.customer_count, 0) as customer_count
  from public.categories c
  left join (
    select
      category_id,
      count(*) as kiosk_count,
      count(distinct customer_id) as customer_count
    from public.kiosks
    where category_id is not null
    group by category_id
  ) k on c.id = k.category_id;
$function$;

grant execute on function public.get_business_types_with_stats(text)
  to anon, authenticated, service_role;
grant execute on function public.get_categories_with_stats()
  to anon, authenticated, service_role;
