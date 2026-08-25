drop function if exists public.get_audit_logs(text, text, text, timestamptz, timestamptz, text, integer, integer);

create function public.get_audit_logs(
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
      coalesce(al.actor_type, case when al.actor_id is not null then 'staff' when pg_catalog.lower(al.actor_role) in ('public', 'anon') then 'public' else 'system' end) as actor_type,
      coalesce(ur.role, al.actor_role, 'system') as actor_role,
      al.module,
      coalesce(al.entity, al.module) as entity,
      al.record_id,
      al.action,
      al.before,
      al.after,
      al.reason,
      al.created_at
    from public.audit_logs al
    left join public.user_roles ur on ur.user_id = al.actor_id
  ),
  filtered as materialized (
    select *
    from resolved r
    where (show_technical or r.action = any (array[
        'create', 'delete', 'confirm', 'cancel', 'reject', 'approve', 'approved',
        'reset_password', 'set_active', 'admin_manual_renewal', 'confirm_payos',
        'confirm_payos_batch', 'review_legacy_approve', 'review_legacy_cancel',
        'create_promotion', 'update_promotion', 'pause_promotion',
        'reactivate_promotion', 'delete_promotion'
      ]::text[]))
      and (nullif(pg_catalog.btrim(actor_filter), '') is null
        or r.actor_name ilike '%' || pg_catalog.btrim(actor_filter) || '%'
        or r.actor_role ilike '%' || pg_catalog.btrim(actor_filter) || '%'
        or r.actor_type ilike '%' || pg_catalog.btrim(actor_filter) || '%'
        or r.actor_id::text = pg_catalog.btrim(actor_filter))
      and (nullif(pg_catalog.btrim(module_filter), '') is null or pg_catalog.lower(r.module) = pg_catalog.lower(pg_catalog.btrim(module_filter)))
      and (nullif(pg_catalog.btrim(action_filter), '') is null or pg_catalog.lower(r.action) = pg_catalog.lower(pg_catalog.btrim(action_filter)))
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
    select count(*)::integer as total from filtered
  ),
  bounds as (
    select total, least(normalized_page, greatest(1, ceil(total::numeric / normalized_size)::integer)) as effective_page
    from stats
  ),
  paged as (
    select f.*
    from filtered f cross join bounds b
    order by f.created_at desc, f.id desc
    limit normalized_size
    offset ((select effective_page from bounds) - 1) * normalized_size
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at desc, p.id desc) from paged p), '[]'::jsonb),
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
