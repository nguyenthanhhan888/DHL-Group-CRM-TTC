-- Forward-only repair for effective PayOS functions that write the nonexistent
-- public.registration_requests.updated_at column. The table's documented
-- lifecycle timestamps are submitted_at and reviewed_at.

do $migration$
declare
  target regprocedure;
  original_definition text;
  corrected_definition text;
begin
  target := 'private.confirm_registration_batch_from_payos(bigint,text)'::regprocedure;
  original_definition := pg_catalog.pg_get_functiondef(target);
  corrected_definition := pg_catalog.replace(
    original_definition,
    ',updated_at=confirmation_timestamp where id=item_record.registration_request_id',
    ' where id=item_record.registration_request_id'
  );
  if corrected_definition = original_definition then
    raise exception 'Expected registration_requests.updated_at write was not found in %.', target;
  end if;
  execute corrected_definition;

  target := 'private.sync_registration_period_from_completed_payment()'::regprocedure;
  original_definition := pg_catalog.pg_get_functiondef(target);
  corrected_definition := pg_catalog.replace(
    original_definition,
    ',updated_at=pg_catalog.now()',
    ''
  );
  corrected_definition := pg_catalog.replace(
    corrected_definition,
    ',updated_at=now()',
    ''
  );
  if corrected_definition = original_definition then
    raise exception 'Expected registration_requests.updated_at write was not found in %.', target;
  end if;
  execute corrected_definition;

  target := 'public.handle_payos_webhook(bigint,numeric,text,text,jsonb,text,text)'::regprocedure;
  original_definition := pg_catalog.pg_get_functiondef(target);
  corrected_definition := pg_catalog.replace(
    original_definition,
    ',updated_at=pg_catalog.now() where payment_id=payment_record.id and status=''pending''',
    ' where payment_id=payment_record.id and status=''pending'''
  );
  corrected_definition := pg_catalog.replace(
    corrected_definition,
    ',updated_at=now() where payment_id=payment_record.id and status=''pending''',
    ' where payment_id=payment_record.id and status=''pending'''
  );
  if corrected_definition = original_definition then
    raise exception 'Expected registration_requests.updated_at write was not found in %.', target;
  end if;
  execute corrected_definition;
end;
$migration$;
