
create table if not exists backup_20260722_before_reimport.categories_before_service_normalization
as table public.categories;

create table if not exists backup_20260722_before_reimport.business_types_before_service_normalization
as table public.business_types;

create table if not exists backup_20260722_before_reimport.kiosk_service_mapping_before_normalization
as
select id as kiosk_id,category_id,business_type_id,service_name
from public.kiosks;
;
