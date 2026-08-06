update public.ttc_interaction_types
set is_active = case
    when code like 'facebook\_%' escape '\' then true
    else false
  end,
  updated_at = now()
where code in ('like', 'reaction', 'comment', 'share', 'follow', 'join_group')
  or code like 'facebook\_%' escape '\'
  or code like 'tiktok\_%' escape '\'
  or code like 'instagram\_%' escape '\'
  or code like 'youtube\_%' escape '\';
