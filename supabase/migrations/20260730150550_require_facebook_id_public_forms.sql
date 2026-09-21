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
      or nullif(trim(kiosk_item->>'facebook_link'), '') is null then
      raise exception 'Kiosk số % cần tên Facebook và link Facebook.', item_number using errcode = '22023';
    end if;
    if nullif(regexp_replace(coalesce(kiosk_item->>'facebook_id', ''), '[^0-9]', '', 'g'), '') is null
      or trim(kiosk_item->>'facebook_id') !~ '^[0-9]{5,30}$' then
      raise exception 'Kiosk số % cần Facebook ID dạng số hợp lệ.', item_number using errcode = '22023';
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
    raise exception 'Không tìm thấy nội dung submit_public_registration cần cập nhật.';
  end if;
  execute updated_sql;
end;
$migration$;

do $migration$
declare
  function_sql text;
  updated_sql text;
begin
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
      if facebook_id_value = any(resolved_ids) then
        raise exception 'Facebook ID bị trùng trong cùng yêu cầu.' using errcode = '23505';
      end if;

      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('public-legacy:' || facebook_id_value, 0));
      if exists (select 1 from public.kiosks k where k.facebook_id = facebook_id_value)
        or exists (select 1 from public.customers c where c.facebook_id = facebook_id_value)
        or exists (
          select 1 from public.registration_requests r
          where r.facebook_id = facebook_id_value and r.status = 'pending'
        ) then
        raise exception 'Facebook ID đã được sử dụng hoặc đang chờ Ban quản trị xử lý.' using errcode = '23505';
      end if;
    end if;
$old$,
    $new$
    if facebook_id_value is null or trim(kiosk_item->>'facebook_id') !~ '^[0-9]{5,30}$'
      or facebook_link_value is null then
      raise exception 'Kiosk số % cần Facebook ID dạng số và link Facebook.', item_number using errcode = '22023';
    end if;
    if facebook_id_value = any(resolved_ids) then
      raise exception 'Facebook ID bị trùng trong cùng yêu cầu.' using errcode = '23505';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('public-legacy:' || facebook_id_value, 0));
    if exists (select 1 from public.kiosks k where k.facebook_id = facebook_id_value)
      or exists (select 1 from public.customers c where c.facebook_id = facebook_id_value)
      or exists (
        select 1 from public.registration_requests r
        where r.facebook_id = facebook_id_value and r.status = 'pending'
      ) then
      raise exception 'Facebook ID đã được sử dụng hoặc đang chờ Ban quản trị xử lý.' using errcode = '23505';
    end if;
$new$
  );
  if updated_sql = function_sql then
    raise exception 'Không tìm thấy nội dung submit_public_legacy_registration cần cập nhật.';
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
;
