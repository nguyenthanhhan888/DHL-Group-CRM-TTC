create or replace function public.get_public_organization_settings()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(jsonb_object_agg(s.key, coalesce(s.value, '')), '{}'::jsonb)
  from public.settings s
  where s.key = any(array[
    'official_group_name',
    'group_url',
    'sub_group_url',
    'recruitment_group_url',
    'fanpage_url',
    'zalo_url',
    'support_phone',
    'facebook_group_id',
    'warning_days'
  ]);
$function$;

revoke all on function public.get_public_organization_settings() from public, anon, authenticated;
grant execute on function public.get_public_organization_settings() to anon, authenticated;
