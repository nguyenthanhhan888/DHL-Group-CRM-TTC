-- Forward-only safe deletion for Promotion Admin.
-- Financial and registration history is never cascaded or rewritten.

create or replace function public.admin_delete_unused_promotion(promotion_id_input bigint)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare promotion_record public.promotions%rowtype;
begin
  if not (select public.is_active_promotion_admin()) then
    raise exception 'Bạn không có quyền quản lý mã giảm giá.' using errcode = '42501';
  end if;

  select p.* into promotion_record
  from public.promotions as p
  where p.id = promotion_id_input
  for update;
  if not found then
    raise exception 'Không tìm thấy chương trình khuyến mãi.' using errcode = 'P0002';
  end if;

  if exists (select 1 from public.promotion_usages as pu where pu.promotion_id = promotion_record.id)
    or exists (
      select 1 from public.registration_batches as b
      where b.promotion_id = promotion_record.id
         or b.promotion_snapshot->>'promotionId' = promotion_record.id::text
    )
    or exists (
      select 1
      from public.payments as pay
      join public.registration_batches as b
        on b.id = pay.registration_batch_id or b.payment_id = pay.id
      where (b.promotion_id = promotion_record.id
          or b.promotion_snapshot->>'promotionId' = promotion_record.id::text)
        and pay.payment_status = 'completed'
    ) then
    raise exception E'Không thể xóa chương trình đã phát sinh giao dịch.\nBạn có thể tạm ngưng chương trình này để ngừng sử dụng.' using errcode = 'P0001';
  end if;

  perform private.write_ttc_audit('Promotion','delete_promotion','promotions',promotion_record.id::text,to_jsonb(promotion_record),null,'Deleted unused promotion');
  delete from public.promotions as p where p.id = promotion_record.id;
  return jsonb_build_object('deleted',true,'id',promotion_record.id,'code',promotion_record.code,'name',promotion_record.name);
end;
$function$;
revoke all on function public.admin_delete_unused_promotion(bigint) from public,anon,authenticated;
grant execute on function public.admin_delete_unused_promotion(bigint) to authenticated;
-- Deletion remains RPC-only; existing SELECT and column-scoped UPDATE grants stay unchanged.
revoke delete on table public.promotions from public,anon,authenticated;
notify pgrst, 'reload schema';
