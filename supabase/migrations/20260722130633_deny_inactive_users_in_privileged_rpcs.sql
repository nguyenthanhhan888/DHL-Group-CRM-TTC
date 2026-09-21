do $migration$
declare
  function_definition text;
  function_oid oid;
begin
  foreach function_oid in array array[
    'public.approve_registration_request(bigint)'::regprocedure::oid,
    'public.reject_registration_request(bigint,text)'::regprocedure::oid
  ]
  loop
    select pg_get_functiondef(function_oid) into function_definition;
    function_definition := replace(
      function_definition,
      'if actor_role not in (''admin'', ''reviewer'') then',
      'if actor_role is null or actor_role not in (''admin'', ''reviewer'') then'
    );
    execute function_definition;
  end loop;

  select pg_get_functiondef('public.confirm_payment(bigint)'::regprocedure::oid)
  into function_definition;
  function_definition := replace(
    function_definition,
    'if private.current_user_role() <> ''admin'' then',
    'if private.current_user_role() is distinct from ''admin'' then'
  );
  execute function_definition;
end
$migration$;;
