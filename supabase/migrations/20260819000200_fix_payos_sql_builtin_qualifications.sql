-- Forward-only repair for SQL special forms that were incorrectly emitted as
-- pg_catalog function calls in the active registration-batch definitions.
-- Preserve the deployed signatures, privileges and function bodies otherwise.

do $migration$
declare
  target regprocedure;
  original_definition text;
  corrected_definition text;
  invalid_name text;
  catalog_prefix constant text := 'pg_catalog.';
begin
  foreach target in array array[
    'public.prepare_registration_batch_for_payos(bigint[],text)'::regprocedure,
    'private.confirm_registration_batch_from_payos(bigint,text)'::regprocedure,
    'public.record_registration_payos_order(bigint,bigint,numeric,text,text,text,text,jsonb)'::regprocedure,
    'public.handle_payos_webhook(bigint,numeric,text,text,jsonb,text,text)'::regprocedure
  ] loop
    original_definition := pg_catalog.pg_get_functiondef(target);
    corrected_definition := pg_catalog.replace(
      original_definition,
      catalog_prefix || 'coalesce(',
      'coalesce('
    );
    corrected_definition := pg_catalog.replace(
      corrected_definition,
      catalog_prefix || 'trim(',
      'btrim('
    );

    -- CREATE OR REPLACE preserves each function's OID, grants and callers.
    execute corrected_definition;

    corrected_definition := pg_catalog.pg_get_functiondef(target);
    foreach invalid_name in array array[
      'coalesce', 'trim', 'nullif', 'greatest', 'least', 'extract',
      'current_date', 'current_timestamp', 'case', 'cast', 'date', 'interval',
      'position'
    ] loop
      if pg_catalog.strpos(pg_catalog.lower(corrected_definition), catalog_prefix || invalid_name) > 0 then
        raise exception 'Invalid qualified SQL special form remains in %: %', target, invalid_name;
      end if;
    end loop;
  end loop;
end;
$migration$;
