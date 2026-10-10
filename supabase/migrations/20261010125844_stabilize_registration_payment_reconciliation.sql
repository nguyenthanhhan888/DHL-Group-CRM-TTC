-- Keep public pre-checkout rows technical until PayOS has returned a usable
-- checkout artifact, and make the Kiosk reconciliation detector use the
-- canonical payments.kiosk_id -> kiosks.id relationship.
begin;

do $migration$
declare
  definition text;
  patched text;
  needle text := $needle$
      'payos_has_checkout_url', nullif(pg_catalog.btrim(coalesce(po.checkout_url, p.payos_checkout_url, '')), '') is not null,
      'payos_expires_at', coalesce(po.expires_at, p.payos_expire_at),
$needle$;
  replacement text := $replacement$
      'payos_has_checkout_url', nullif(pg_catalog.btrim(coalesce(po.checkout_url, p.payos_checkout_url, '')), '') is not null,
      'payos_checkout_created',
        nullif(pg_catalog.btrim(coalesce(p.payos_checkout_url, '')), '') is not null
        or exists (
          select 1
          from public.payos_orders checkout_order
          where checkout_order.payment_id = p.id
            and checkout_order.purpose = 'crm_payment'
            and (
              nullif(pg_catalog.btrim(coalesce(checkout_order.checkout_url, '')), '') is not null
              or nullif(pg_catalog.btrim(coalesce(checkout_order.qr_code, '')), '') is not null
              or nullif(pg_catalog.btrim(coalesce(checkout_order.payment_link_id, '')), '') is not null
            )
        ),
      'payos_expires_at', coalesce(po.expires_at, p.payos_expire_at),
$replacement$;
begin
  select pg_catalog.pg_get_functiondef(
    'public.admin_list_registration_requests(text)'::regprocedure
  ) into definition;
  patched := pg_catalog.replace(definition, needle, replacement);
  if patched = definition then
    raise exception 'admin_list_registration_requests checkout marker did not match';
  end if;
  execute patched;
end
$migration$;

do $migration$
declare
  definition text;
  patched text;
  needle text := $needle$
      select 'payment_without_kiosk', 'Thanh toán thiếu Kiosk', 'payment',
        p.id::text, p.id, p.customer_id, p.kiosk_id,
        coalesce(c.facebook_name, 'Không tên'), 'Không tên',
        lower(coalesce(p.payment_status, 'unknown')), coalesce(p.total_amount, 0),
        coalesce(p.confirmed_at, p.created_at)
      from public.payment_business_dates p
      left join public.customers c on c.id = p.customer_id
      left join public.registered_kiosks k on k.id = p.kiosk_id
      where p.kiosk_id is null or k.id is null
$needle$;
  replacement text := $replacement$
      select 'payment_without_kiosk', 'Thanh toán thiếu Kiosk', 'payment',
        p.id::text, p.id, p.customer_id, p.kiosk_id,
        coalesce(c.facebook_name, 'Không tên'), 'Không tên',
        lower(coalesce(p.payment_status, 'unknown')), coalesce(p.total_amount, 0),
        coalesce(p.confirmed_at, p.created_at)
      from public.payment_business_dates p
      left join public.customers c on c.id = p.customer_id
      left join public.kiosks k on k.id = p.kiosk_id
      where p.kiosk_id is null or k.id is null
$replacement$;
begin
  select pg_catalog.pg_get_functiondef(
    'public.get_reports_data_filtered(text,date,date,bigint,bigint,bigint,bigint,text,text,text,text,integer,integer,text)'::regprocedure
  ) into definition;
  patched := pg_catalog.replace(definition, needle, replacement);
  if patched = definition then
    raise exception 'payment_without_kiosk detector did not match';
  end if;
  execute patched;
end
$migration$;

commit;
