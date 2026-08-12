-- Use the canonical verified JWT claims object for the server-only renewal RPC.
-- This replaces the legacy single-claim setting check without changing
-- the function signature or widening EXECUTE privileges.

create or replace function public.register_public_renewal_authorization(
  kiosk_id_input bigint,
  nonce_hash_input text,
  expires_at_input timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'Chỉ API server được cấp quyền gia hạn.' using errcode = '42501';
  end if;

  if expires_at_input <= now()
    or expires_at_input > now() + interval '15 minutes' then
    raise exception 'Hạn token không hợp lệ.' using errcode = '22023';
  end if;

  insert into private.public_renewal_authorizations(
    nonce_hash,
    kiosk_id,
    expires_at
  ) values (
    nonce_hash_input,
    kiosk_id_input,
    expires_at_input
  );
end;
$function$;

revoke all on function public.register_public_renewal_authorization(bigint, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.register_public_renewal_authorization(bigint, text, timestamptz)
  to service_role;
