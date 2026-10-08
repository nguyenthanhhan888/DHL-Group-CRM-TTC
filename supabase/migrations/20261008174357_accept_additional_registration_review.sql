begin;

do $migration$
declare
  original_definition text;
  updated_definition text;
  old_guard constant text := $guard$if request_record.metadata->>'request_type' <> 'legacy' then$guard$;
  new_guard constant text := $guard$if coalesce(
      nullif(pg_catalog.lower(pg_catalog.btrim(request_record.metadata->>'request_type')), ''),
      nullif(pg_catalog.lower(pg_catalog.btrim(request_record.metadata->>'source')), ''),
      ''
    ) not in ('legacy', 'additional') then$guard$;
begin
  original_definition := pg_catalog.pg_get_functiondef(
    'public.review_public_legacy_registration_request(bigint,text,text)'::regprocedure
  );
  updated_definition := pg_catalog.replace(original_definition, old_guard, new_guard);

  if updated_definition = original_definition then
    raise exception 'Expected registration workflow guard was not found.';
  end if;

  execute updated_definition;
end;
$migration$;

commit;
