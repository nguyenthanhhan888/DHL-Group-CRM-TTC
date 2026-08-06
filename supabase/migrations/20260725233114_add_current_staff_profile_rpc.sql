create or replace function public.get_current_staff_profile()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  profile public.user_roles%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Bạn phải đăng nhập.' using errcode = '42501';
  end if;

  select *
  into profile
  from public.user_roles ur
  where ur.user_id = auth.uid();

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'user_id', profile.user_id,
    'username', profile.username,
    'display_name', profile.display_name,
    'role', profile.role,
    'is_active', profile.is_active
  );
end;
$function$;

revoke all on function public.get_current_staff_profile() from public, anon, authenticated;
grant execute on function public.get_current_staff_profile() to authenticated;

notify pgrst, 'reload schema';
