
create unique index if not exists kiosks_facebook_id_unique
on public.kiosks (facebook_id)
where facebook_id is not null;

comment on index public.kiosks_facebook_id_unique is
'Mỗi Facebook ID chỉ được tồn tại ở một kiosk';
;
