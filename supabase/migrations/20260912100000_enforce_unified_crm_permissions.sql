-- Remove the temporary authenticated-wide CRM baseline and enforce the
-- canonical per-user permission model for direct Data API access.

alter table public.customers enable row level security;
alter table public.kiosks enable row level security;
alter table public.payments enable row level security;
alter table public.categories enable row level security;
alter table public.business_types enable row level security;
alter table public.registration_requests enable row level security;
alter table public.settings enable row level security;
drop policy if exists task08_authenticated_baseline on public.customers;
drop policy if exists task08_authenticated_baseline on public.kiosks;
drop policy if exists task08_authenticated_baseline on public.payments;
drop policy if exists task08_authenticated_baseline on public.categories;
drop policy if exists task08_authenticated_baseline on public.business_types;
drop policy if exists task08_authenticated_baseline on public.registration_requests;
drop policy if exists task08_authenticated_baseline on public.settings;
drop policy if exists task08_active_permission_guard on public.customers;
drop policy if exists task08_active_permission_guard on public.kiosks;
drop policy if exists task08_active_permission_guard on public.payments;
drop policy if exists task08_active_permission_guard on public.categories;
drop policy if exists task08_active_permission_guard on public.business_types;
drop policy if exists task08_active_permission_guard on public.registration_requests;
drop policy if exists task08_active_permission_guard on public.settings;
drop policy if exists unified_customers_permission on public.customers;
create policy unified_customers_permission
on public.customers for all to authenticated
using (
  (select public.has_user_permission('customers'))
  or (select public.has_user_permission('customer-detail'))
)
with check (
  (select public.has_user_permission('customers'))
  or (select public.has_user_permission('customer-detail'))
);
drop policy if exists unified_kiosks_permission on public.kiosks;
create policy unified_kiosks_permission
on public.kiosks for all to authenticated
using (
  (select public.has_user_permission('kiosks'))
  or (select public.has_user_permission('kiosk-detail'))
)
with check (
  (select public.has_user_permission('kiosks'))
  or (select public.has_user_permission('kiosk-detail'))
);
drop policy if exists unified_payments_permission on public.payments;
create policy unified_payments_permission
on public.payments for all to authenticated
using (
  (select public.has_user_permission('payments'))
  or (select public.has_user_permission('payment-detail'))
)
with check (
  (select public.has_user_permission('payments'))
  or (select public.has_user_permission('payment-detail'))
);
drop policy if exists unified_categories_permission on public.categories;
create policy unified_categories_permission
on public.categories for all to authenticated
using ((select public.has_user_permission('categories')))
with check ((select public.has_user_permission('categories')));
drop policy if exists unified_business_types_permission on public.business_types;
create policy unified_business_types_permission
on public.business_types for all to authenticated
using ((select public.has_user_permission('business-types')))
with check ((select public.has_user_permission('business-types')));
drop policy if exists unified_registration_requests_permission on public.registration_requests;
create policy unified_registration_requests_permission
on public.registration_requests for all to authenticated
using ((select public.has_user_permission('registration-requests')))
with check ((select public.has_user_permission('registration-requests')));
drop policy if exists unified_settings_permission on public.settings;
create policy unified_settings_permission
on public.settings for all to authenticated
using ((select public.has_user_permission('settings')))
with check ((select public.has_user_permission('settings')));
comment on policy unified_customers_permission on public.customers is
  'Canonical direct Data API guard for customer modules.';
comment on policy unified_kiosks_permission on public.kiosks is
  'Canonical direct Data API guard for Kiosk modules.';
comment on policy unified_payments_permission on public.payments is
  'Canonical direct Data API guard for payment modules.';
