-- Public forms require a confirmed/manual numeric Facebook ID at final submit.
-- Keep both workflows transactional by tightening the existing atomic RPCs.
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
      or nullif(trim(kiosk_item->>'facebook_link'), '') is null then
      raise exception 'Kiosk số % cần tên Facebook và link Facebook.', item_number using errcode = '22023';
    end if;
$old$,
    $new$
    if nullif(trim(kiosk_item->>'facebook_name'), '') is null
      or nullif(trim(kiosk_item->>'facebook_link'), '') is null
      or nullif(trim(kiosk_item->>'facebook_id'), '') is null then
      raise exception 'Kiosk số % cần tên Facebook, link Facebook và Facebook ID.', item_number using errcode = '22023';
    end if;
    if trim(kiosk_item->>'facebook_id') !~ '^[0-9]+$' then
      raise exception 'Facebook ID của kiosk số % chỉ được chứa chữ số.', item_number using errcode = '22023';
    end if;
$new$
  );
  updated_sql := replace(
    updated_sql,
    $old$
      customer_phone,
      null,
      kiosk_item->>'facebook_link',
$old$,
    $new$
      customer_phone,
      trim(kiosk_item->>'facebook_id'),
      kiosk_item->>'facebook_link',
$new$
  );
  if updated_sql = function_sql then
    raise exception 'Không tìm thấy các khối cần cập nhật trong submit_public_registration.';
  end if;
  execute updated_sql;

  function_sql := pg_get_functiondef(
    'public.submit_public_legacy_registration(jsonb,jsonb)'::regprocedure
  );
  updated_sql := replace(
    function_sql,
    $old$
    if facebook_link_value is null then
      raise exception 'Kiosk số % cần link Facebook.', item_number using errcode = '22023';
    end if;
    if facebook_id_value is not null then
$old$,
    $new$
    if facebook_link_value is null or facebook_id_value is null then
      raise exception 'Kiosk số % cần link Facebook và Facebook ID.', item_number using errcode = '22023';
    end if;
    if trim(kiosk_item->>'facebook_id') !~ '^[0-9]+$' then
      raise exception 'Facebook ID của kiosk số % chỉ được chứa chữ số.', item_number using errcode = '22023';
    end if;
    if facebook_id_value is not null then
$new$
  );
  updated_sql := replace(
    updated_sql,
    $old$
          'phone', customer_phone
$old$,
    $new$
          'phone', customer_phone,
          'note', nullif(trim(customer_input->>'note'), '')
$new$
  );
  if updated_sql = function_sql then
    raise exception 'Không tìm thấy các khối cần cập nhật trong submit_public_legacy_registration.';
  end if;
  execute updated_sql;
end;
$migration$;

revoke all on function public.submit_public_registration(jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.submit_public_registration(jsonb, jsonb, jsonb)
  to anon, authenticated;

revoke all on function public.submit_public_legacy_registration(jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.submit_public_legacy_registration(jsonb, jsonb)
  to anon, authenticated;
