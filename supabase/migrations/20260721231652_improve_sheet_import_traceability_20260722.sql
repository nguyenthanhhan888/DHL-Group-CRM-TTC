
alter table public.sheet_import add column if not exists source_row integer;
alter table public.sheet_import add column if not exists fb_id text;
alter table public.sheet_import add column if not exists imported_at timestamptz not null default now();
comment on table public.sheet_import is 'Dữ liệu nguồn thô từ file Excel để đối chiếu và kiểm toán import';
;
