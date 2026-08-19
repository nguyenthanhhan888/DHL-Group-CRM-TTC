-- Replace the dashboard's recent-customer list with one normalized row per
-- registration request. Batch items own their per-Kiosk amount; non-batch
-- requests retain their request-level amount.

do $migration$
declare
  target regprocedure := 'public.get_dashboard_data(integer,integer)'::regprocedure;
  original_definition text;
  corrected_definition text;
  old_recent_customers text := $old$
  recent_customers as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', item.id,
          'facebook_name', item.facebook_name,
          'created_at', item.created_at
        )
        order by item.created_at desc, item.id desc
      ),
      '[]'::jsonb
    ) as data
    from (
      select id, facebook_name, created_at
      from public.customers
      order by created_at desc, id desc
      limit 5
    ) item
  )
$old$;
  new_recent_registrations text := $new$
  recent_registrations as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', item.id,
          'kioskName', item.kiosk_name,
          'amount', item.amount,
          'createdAt', item.created_at
        )
        order by item.created_at desc, item.id desc
      ),
      '[]'::jsonb
    ) as data
    from (
      select
        r.id,
        coalesce(nullif(k.facebook_name, ''), nullif(r.facebook_name, ''), 'Kiosk') as kiosk_name,
        case
          when bi.id is not null then bi.total_amount
          else coalesce(r.total_amount, 0)
        end as amount,
        r.submitted_at as created_at
      from public.registration_requests r
      left join public.registration_batch_items bi on bi.registration_request_id = r.id
      left join public.kiosks k on k.id = coalesce(bi.kiosk_id, r.kiosk_id)
      order by r.submitted_at desc, r.id desc
      limit 5
    ) item
  )
$new$;
begin
  select pg_catalog.pg_get_functiondef(target) into original_definition;

  corrected_definition := replace(
    original_definition,
    old_recent_customers,
    new_recent_registrations
  );
  corrected_definition := replace(
    corrected_definition,
    '''recentCustomers'', coalesce(rc.data, ''[]''::jsonb)',
    '''recentRegistrations'', coalesce(rr.data, ''[]''::jsonb)'
  );
  corrected_definition := replace(
    corrected_definition,
    'cross join recent_customers rc',
    'cross join recent_registrations rr'
  );

  if corrected_definition = original_definition
    or corrected_definition like '%recent_customers as (%'
    or corrected_definition like '%''recentCustomers''%'
    or corrected_definition like '%cross join recent_customers rc%' then
    raise exception 'Expected recent-customer dashboard SQL was not found in %.', target;
  end if;

  execute corrected_definition;
end;
$migration$;

revoke all on function public.get_dashboard_data(integer, integer) from public, anon;
grant execute on function public.get_dashboard_data(integer, integer) to authenticated;
