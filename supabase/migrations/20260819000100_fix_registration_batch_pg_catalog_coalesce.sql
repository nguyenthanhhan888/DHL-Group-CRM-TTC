-- PostgreSQL COALESCE is special SQL syntax, not a pg_catalog function.
-- The applied batch migration schema-qualified it, causing SQLSTATE 42883 at
-- function entry. Preserve every signature/permission and replace only that
-- invalid qualification in the four definitions introduced by that migration.

do $migration$
declare
  target regprocedure;
  original_definition text;
  corrected_definition text;
begin
  foreach target in array array[
    'public.prepare_registration_batch_for_payos(bigint[],text)'::regprocedure,
    'private.confirm_registration_batch_from_payos(bigint,text)'::regprocedure,
    'public.record_registration_payos_order(bigint,bigint,numeric,text,text,text,text,jsonb)'::regprocedure,
    'public.handle_payos_webhook(bigint,numeric,text,text,jsonb,text,text)'::regprocedure
  ]
  loop
    original_definition := pg_catalog.pg_get_functiondef(target);
    corrected_definition := pg_catalog.replace(
      original_definition,
      'pg_catalog.coalesce(',
      'coalesce('
    );

    if corrected_definition = original_definition then
      raise exception 'Expected invalid pg_catalog.coalesce call was not found in %.', target;
    end if;

    execute corrected_definition;
  end loop;
end;
$migration$;
