create or replace function public.get_audit_logs(
  actor_filter text default null,
  module_filter text default null,
  action_filter text default null,
  from_time timestamptz default null,
  to_time timestamptz default null,
  search_term text default null,
  show_technical boolean default false,
  page_number integer default 1,
  page_size integer default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  normalized_page integer := greatest(coalesce(page_number, 1), 1);
  normalized_size integer := case when page_size in (10, 20, 50) then page_size else 20 end;
  requested_category text := case pg_catalog.lower(nullif(pg_catalog.btrim(module_filter), ''))
    when 'kiosk' then 'kiosk'
    when 'kiosks' then 'kiosk'
    when 'registration' then 'kiosk'
    when 'registrations' then 'kiosk'
    when 'registration_request' then 'kiosk'
    when 'registration_requests' then 'kiosk'
    when 'registration_batch' then 'kiosk'
    when 'registration_batches' then 'kiosk'
    when 'public_registration' then 'kiosk'
    when 'public_registrations' then 'kiosk'
    when 'customer' then 'customer'
    when 'customers' then 'customer'
    when 'client' then 'customer'
    when 'clients' then 'customer'
    when 'payment' then 'payment'
    when 'payments' then 'payment'
    when 'transaction' then 'payment'
    when 'transactions' then 'payment'
    when 'payos' then 'payment'
    when 'payment_intent' then 'payment'
    when 'payment_intents' then 'payment'
    when 'payment_order' then 'payment'
    when 'payment_orders' then 'payment'
    when 'renewal' then 'renewal'
    when 'renewals' then 'renewal'
    when 'kiosk_renewal' then 'renewal'
    when 'kiosk_renewals' then 'renewal'
    when 'gia_han' then 'renewal'
    when 'usermanagement' then 'user'
    when 'user_management' then 'user'
    when 'user-management' then 'user'
    when 'user' then 'user'
    when 'users' then 'user'
    when 'user_profile' then 'user'
    when 'user_profiles' then 'user'
    when 'staff' then 'user'
    when 'staffs' then 'user'
    when 'staff_member' then 'user'
    when 'staff_members' then 'user'
    when 'personnel' then 'user'
    when 'employee' then 'user'
    when 'employees' then 'user'
    when 'permission' then 'user'
    when 'permissions' then 'user'
    when 'user_permission' then 'user'
    when 'user_permissions' then 'user'
    when 'wallet' then 'user'
    when 'wallets' then 'user'
    when 'ttc_wallet' then 'user'
    when 'ttc_wallets' then 'user'
    when 'ttc_user_wallet' then 'user'
    when 'ttc_user_wallets' then 'user'
    when 'promotion' then 'promotion'
    when 'promotions' then 'promotion'
    when 'discount' then 'promotion'
    when 'discounts' then 'promotion'
    when 'coupon' then 'promotion'
    when 'coupons' then 'promotion'
    when 'promotion_usage' then 'promotion'
    when 'promotion_usages' then 'promotion'
    when 'system' then 'system'
    when 'webhook' then 'system'
    when 'webhooks' then 'system'
    when 'cron' then 'system'
    when 'cleanup' then 'system'
    when 'sync' then 'system'
    when 'synchronization' then 'system'
    when 'trigger' then 'system'
    when 'database_trigger' then 'system'
    else pg_catalog.lower(nullif(pg_catalog.btrim(module_filter), ''))
  end;
  result jsonb;
begin
  perform private.assert_audit_access();

  with resolved as materialized (
    select
      al.id,
      al.actor_id,
      case
        when al.actor_id is not null then coalesce(ur.display_name, ur.username, al.actor_name, 'Nhân viên')
        when coalesce(al.actor_type, pg_catalog.lower(al.actor_role)) in ('public', 'anon') then 'Public User'
        when al.actor_type = 'database_trigger' then 'Database Trigger'
        else 'System'
      end as actor_name,
      coalesce(
        al.actor_type,
        case
          when al.actor_id is not null then 'staff'
          when pg_catalog.lower(al.actor_role) in ('public', 'anon') then 'public'
          else 'system'
        end
      ) as actor_type,
      coalesce(ur.role, al.actor_role, 'system') as actor_role,
      al.module,
      coalesce(al.entity, al.module) as entity,
      al.record_id,
      al.action,
      al.before,
      al.after,
      al.reason,
      al.created_at,
      pg_catalog.lower(pg_catalog.btrim(coalesce(al.module, ''))) as normalized_module,
      pg_catalog.lower(pg_catalog.btrim(coalesce(al.entity, ''))) as normalized_entity,
      pg_catalog.lower(pg_catalog.btrim(coalesce(al.action, ''))) as normalized_action
    from public.audit_logs al
    left join public.user_roles ur on ur.user_id = al.actor_id
  ),
  classified as materialized (
    select
      r.*,
      case
        when r.normalized_module = any (array['renewal','renewals','kiosk_renewal','kiosk_renewals','gia_han']::text[])
          or r.normalized_entity = any (array['renewal','renewals','kiosk_renewal','kiosk_renewals','gia_han']::text[])
          or r.normalized_action = 'admin_manual_renewal'
          or r.normalized_action like '%renewal%'
          then 'renewal'
        when r.normalized_module = any (array['promotion','promotions','discount','discounts','coupon','coupons','promotion_usage','promotion_usages']::text[])
          or r.normalized_entity = any (array['promotion','promotions','discount','discounts','coupon','coupons','promotion_usage','promotion_usages']::text[])
          or r.normalized_action like '%promotion%'
          then 'promotion'
        when r.normalized_module = any (array['payment','payments','transaction','transactions','payos','payment_intent','payment_intents','payment_order','payment_orders']::text[])
          or r.normalized_entity = any (array['payment','payments','transaction','transactions','payos','payment_intent','payment_intents','payment_order','payment_orders']::text[])
          or r.normalized_action like '%payos%'
          or r.normalized_action like '%payment%'
          or r.normalized_action like '%refund%'
          then 'payment'
        when r.normalized_module = any (array['usermanagement','user_management','user-management','user','users','user_profile','user_profiles','staff','staffs','staff_member','staff_members','personnel','employee','employees','permission','permissions','user_permission','user_permissions','wallet','wallets','ttc_wallet','ttc_wallets','ttc_user_wallet','ttc_user_wallets']::text[])
          or r.normalized_entity = any (array['usermanagement','user_management','user-management','user','users','user_profile','user_profiles','staff','staffs','staff_member','staff_members','personnel','employee','employees','permission','permissions','user_permission','user_permissions','wallet','wallets','ttc_wallet','ttc_wallets','ttc_user_wallet','ttc_user_wallets']::text[])
          or r.normalized_action = any (array['reset_password','update_profile','admin_reset_user_password','admin_update_user_profile','admin_update_user_status','sync_permissions','lock_user','unlock_user','adjust_wallet','admin_adjustment']::text[])
          then 'user'
        when r.normalized_module = any (array['customer','customers','client','clients']::text[])
          or r.normalized_entity = any (array['customer','customers','client','clients']::text[])
          then 'customer'
        when r.normalized_module = any (array['kiosk','kiosks','registration','registrations','registration_request','registration_requests','registration_batch','registration_batches','public_registration','public_registrations']::text[])
          or r.normalized_entity = any (array['kiosk','kiosks','registration','registrations','registration_request','registration_requests','registration_batch','registration_batches','public_registration','public_registrations']::text[])
          or r.normalized_action = any (array['review_legacy_approve','review_legacy_cancel','admin_cancel']::text[])
          then 'kiosk'
        else 'system'
      end as category
    from resolved r
  ),
  visible as materialized (
    select c.*
    from classified c
    where show_technical
      or (
        c.normalized_action = any (array[
          'create', 'update', 'delete', 'confirm', 'cancel', 'reject', 'approve', 'approved',
          'set_active', 'reset_password', 'update_profile', 'admin_reset_user_password',
          'admin_update_user_profile', 'admin_update_user_status', 'sync_permissions',
          'lock_user', 'unlock_user', 'adjust_wallet', 'admin_adjustment',
          'admin_manual_renewal', 'confirm_payos', 'confirm_payos_batch', 'admin_cancel',
          'review_legacy_approve', 'review_legacy_cancel', 'create_promotion',
          'update_promotion', 'pause_promotion', 'reactivate_promotion',
          'delete_promotion', 'expire', 'expired', 'activate', 'deactivate'
        ]::text[])
        and (
          c.category <> 'system'
          or c.normalized_action = any (array['expire','expired','activate','deactivate']::text[])
        )
      )
  ),
  filtered as materialized (
    select *
    from visible r
    where (nullif(pg_catalog.btrim(actor_filter), '') is null
        or r.actor_name ilike '%' || pg_catalog.btrim(actor_filter) || '%'
        or r.actor_role ilike '%' || pg_catalog.btrim(actor_filter) || '%'
        or r.actor_type ilike '%' || pg_catalog.btrim(actor_filter) || '%'
        or r.actor_id::text = pg_catalog.btrim(actor_filter))
      and (requested_category is null
        or r.category = requested_category
        or r.normalized_module = pg_catalog.lower(pg_catalog.btrim(module_filter))
        or r.normalized_entity = pg_catalog.lower(pg_catalog.btrim(module_filter)))
      and (nullif(pg_catalog.btrim(action_filter), '') is null
        or r.normalized_action = pg_catalog.lower(pg_catalog.btrim(action_filter)))
      and (from_time is null or r.created_at >= from_time)
      and (to_time is null or r.created_at < to_time)
      and (nullif(pg_catalog.btrim(search_term), '') is null
        or r.module ilike '%' || pg_catalog.btrim(search_term) || '%'
        or r.entity ilike '%' || pg_catalog.btrim(search_term) || '%'
        or r.action ilike '%' || pg_catalog.btrim(search_term) || '%'
        or r.actor_name ilike '%' || pg_catalog.btrim(search_term) || '%'
        or coalesce(r.reason, '') ilike '%' || pg_catalog.btrim(search_term) || '%'
        or coalesce(r.record_id, '') ilike '%' || pg_catalog.btrim(search_term) || '%')
  ),
  stats as (
    select pg_catalog.count(*)::integer as total from filtered
  ),
  bounds as (
    select
      total,
      least(normalized_page, greatest(1, ceil(total::numeric / normalized_size)::integer)) as effective_page
    from stats
  ),
  paged as (
    select f.*
    from filtered f
    cross join bounds b
    order by f.created_at desc, f.id desc
    limit normalized_size
    offset ((select effective_page from bounds) - 1) * normalized_size
  )
  select pg_catalog.jsonb_build_object(
    'rows', coalesce(
      (
        select pg_catalog.jsonb_agg(
          pg_catalog.to_jsonb(p) - 'normalized_module' - 'normalized_entity' - 'normalized_action'
          order by p.created_at desc, p.id desc
        )
        from paged p
      ),
      '[]'::jsonb
    ),
    'total', b.total,
    'page', b.effective_page,
    'pageSize', normalized_size
  ) into result
  from bounds b;

  return result;
end;
$function$;
revoke all on function public.get_audit_logs(text, text, text, timestamptz, timestamptz, text, boolean, integer, integer)
  from public, anon, authenticated;
grant execute on function public.get_audit_logs(text, text, text, timestamptz, timestamptz, text, boolean, integer, integer)
  to authenticated;
