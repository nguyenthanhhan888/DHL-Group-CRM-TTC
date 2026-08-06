-- Allow public new-kiosk registrations to be submitted with only a Facebook link.
-- The resolver can still fill facebook_id when available; unresolved links stay
-- pending for admin/reviewer verification instead of blocking non-technical users.
do $migration$
declare
  function_sql text;
  updated_sql text;
begin
  function_sql := pg_get_functiondef(
    'public.submit_public_registration(jsonb,jsonb,jsonb)'::regprocedure
  );

  updated_sql := replace(
    function_sql,
    $old$
    if nullif(trim(kiosk_item->>'facebook_name'), '') is null
      or nullif(trim(kiosk_item->>'facebook_link'), '') is null
      or nullif(trim(kiosk_item->>'facebook_id'), '') is null then
      raise exception 'Kiosk số % cần tên Facebook, link Facebook và Facebook ID.', item_number using errcode = '22023';
    end if;
    if trim(kiosk_item->>'facebook_id') !~ '^[0-9]+$' then
      raise exception 'Facebook ID của kiosk số % chỉ được chứa chữ số.', item_number using errcode = '22023';
    end if;
$old$,
    $new$
    if nullif(trim(kiosk_item->>'facebook_name'), '') is null
      or nullif(trim(kiosk_item->>'facebook_link'), '') is null then
      raise exception 'Kiosk số % cần tên Facebook và link Facebook.', item_number using errcode = '22023';
    end if;
    if nullif(trim(kiosk_item->>'facebook_id'), '') is not null
      and trim(kiosk_item->>'facebook_id') !~ '^[0-9]+$' then
      raise exception 'Facebook ID của kiosk số % chỉ được chứa chữ số.', item_number using errcode = '22023';
    end if;
$new$
  );

  if updated_sql = function_sql then
    raise exception 'Không tìm thấy khối bắt buộc Facebook ID trong submit_public_registration.';
  end if;

  execute updated_sql;
end;
$migration$;

revoke all on function public.submit_public_registration(jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.submit_public_registration(jsonb, jsonb, jsonb)
  to anon, authenticated;
