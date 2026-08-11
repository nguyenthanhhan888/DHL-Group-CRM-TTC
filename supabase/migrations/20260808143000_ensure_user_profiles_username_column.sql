alter table public.user_profiles
  add column if not exists username text;

update public.user_profiles
set username = lower(coalesce(
  nullif(metadata->>'username', ''),
  nullif(metadata->>'auth_username', ''),
  nullif(metadata->>'login_username', ''),
  split_part(email, '@', 1)
))
where username is null
  and lower(coalesce(
    nullif(metadata->>'username', ''),
    nullif(metadata->>'auth_username', ''),
    nullif(metadata->>'login_username', ''),
    split_part(email, '@', 1)
  )) ~ '^[a-z0-9._-]{3,40}$'
  and not exists (
    select 1
    from public.user_profiles existing
    where existing.user_id <> user_profiles.user_id
      and lower(existing.username) = lower(coalesce(
        nullif(user_profiles.metadata->>'username', ''),
        nullif(user_profiles.metadata->>'auth_username', ''),
        nullif(user_profiles.metadata->>'login_username', ''),
        split_part(user_profiles.email, '@', 1)
      ))
  );

create unique index if not exists user_profiles_username_unique_idx
  on public.user_profiles (lower(username))
  where username is not null;

create index if not exists user_profiles_phone_login_idx
  on public.user_profiles (phone)
  where phone is not null;
