-- Forward-only repair for Promotion Admin RLS. The original policies queried
-- public.user_roles as the caller, but authenticated CRM users intentionally
-- have no direct privilege on that authorization table.

create or replace function public.is_active_promotion_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.user_roles as ur
    where ur.user_id = (select auth.uid())
      and pg_catalog.lower(ur.role) = 'admin'
      and ur.is_active = true
  );
$function$;

revoke all on function public.is_active_promotion_admin()
from public, anon, authenticated;
grant execute on function public.is_active_promotion_admin()
to authenticated;

drop policy if exists promotions_admin_all on public.promotions;
create policy promotions_admin_all
on public.promotions
for all
to authenticated
using ((select public.is_active_promotion_admin()))
with check ((select public.is_active_promotion_admin()));

drop policy if exists promotion_categories_admin_all on public.promotion_categories;
create policy promotion_categories_admin_all
on public.promotion_categories
for all
to authenticated
using ((select public.is_active_promotion_admin()))
with check ((select public.is_active_promotion_admin()));

drop policy if exists promotion_business_types_admin_all on public.promotion_business_types;
create policy promotion_business_types_admin_all
on public.promotion_business_types
for all
to authenticated
using ((select public.is_active_promotion_admin()))
with check ((select public.is_active_promotion_admin()));

drop policy if exists promotion_usages_admin_read on public.promotion_usages;
create policy promotion_usages_admin_read
on public.promotion_usages
for select
to authenticated
using ((select public.is_active_promotion_admin()));

-- Keep the Data API surface explicit. RLS still decides which authenticated
-- callers can see rows; anon and PUBLIC retain no Promotion table privileges.
revoke all on table public.promotions,public.promotion_categories,
  public.promotion_business_types,public.promotion_usages
from public,anon;

grant select on table public.promotions,public.promotion_categories,
  public.promotion_business_types,public.promotion_usages
to authenticated;
grant update(is_active) on table public.promotions to authenticated;

notify pgrst, 'reload schema';
