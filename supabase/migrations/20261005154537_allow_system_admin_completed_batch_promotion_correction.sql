create or replace function private.protect_completed_batch_promotion_snapshot()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if exists(
    select 1
    from public.payments p
    where p.registration_batch_id=old.id
      and p.payment_status='completed'
  ) and not (
    coalesce(
      pg_catalog.current_setting('app.batch_promotion_workflow_action', true),
      ''
    ) = 'historical_correction'
    and public.is_system_admin()
  ) then
    raise exception 'Không thể thay đổi ảnh chụp ưu đãi của thanh toán đã hoàn tất.'
      using errcode='23514';
  end if;
  return new;
end;
$function$;
