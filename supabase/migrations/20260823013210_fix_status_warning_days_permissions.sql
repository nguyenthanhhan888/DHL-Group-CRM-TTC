-- Status list RPCs are SECURITY INVOKER so their table reads continue to obey
-- the caller's existing permissions and RLS. Expose only the scalar setting
-- they require through a narrowly scoped definer function.
create or replace function public.get_status_warning_days()
returns integer
language sql
stable
security definer
set search_path = ''
as $function$
  select greatest(
    coalesce(
      (
        select case
          when s.value ~ '^\d+$' then s.value::integer
          else null
        end
        from public.settings s
        where s.key = 'warning_days'
      ),
      30
    ),
    0
  )
$function$;

revoke all on function public.get_status_warning_days() from public, anon, authenticated;
grant execute on function public.get_status_warning_days() to authenticated;

-- Replace only the privileged settings lookup in the two new invoker RPCs.
-- pg_get_functiondef preserves their filters, pagination, RLS behavior and
-- shared status contract without editing the already-applied S1 migration.
do $migration$
declare
  target regprocedure;
  definition text;
  changed text;
  old_lookup constant text := $lookup$  select greatest(coalesce(case when s.value ~ '^\d+$' then s.value::integer end, 30), 0)
  into warning_days from public.settings s where s.key = 'warning_days';
  warning_days := coalesce(warning_days, 30);$lookup$;
begin
  foreach target in array array[
    'public.get_kiosk_status_data(text,text,bigint,text,text,integer,integer)'::regprocedure,
    'public.get_customer_status_data(text,text,text,bigint,text,text,integer,integer)'::regprocedure
  ] loop
    select pg_catalog.pg_get_functiondef(target) into definition;
    changed := replace(definition, old_lookup,
      '  warning_days := public.get_status_warning_days();');

    if changed = definition
      or changed like '%from public.settings s where s.key = ''warning_days''%'
      or changed not like '%public.get_status_warning_days()%' then
      raise exception 'Status RPC % did not match the expected warning_days lookup.', target;
    end if;

    execute changed;
  end loop;
end
$migration$;

revoke all on function public.get_kiosk_status_data(text,text,bigint,text,text,integer,integer)
  from public, anon;
grant execute on function public.get_kiosk_status_data(text,text,bigint,text,text,integer,integer)
  to authenticated;

revoke all on function public.get_customer_status_data(text,text,text,bigint,text,text,integer,integer)
  from public, anon;
grant execute on function public.get_customer_status_data(text,text,text,bigint,text,text,integer,integer)
  to authenticated;

