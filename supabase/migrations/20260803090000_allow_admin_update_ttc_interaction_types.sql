grant update(label, unit_cost, worker_reward, min_quantity, max_quantity, hold_seconds, is_active)
on table public.ttc_interaction_types
to authenticated;

drop policy if exists ttc_interaction_types_update_staff on public.ttc_interaction_types;
create policy ttc_interaction_types_update_staff
on public.ttc_interaction_types
for update
to authenticated
using (public.has_active_staff_permission('admin-ttc'))
with check (public.has_active_staff_permission('admin-ttc'));
