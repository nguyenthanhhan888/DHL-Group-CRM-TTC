import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('authenticated CRM table access follows canonical per-user permission', async () => {
  const db = new PGlite();
  try {
    await db.exec(await readFile(new URL('./fixtures/crm-payment-baseline.sql', import.meta.url), 'utf8'));
    await db.exec(`
      create or replace function public.has_user_permission(permission_input text)
      returns boolean
      language sql
      stable
      security definer
      set search_path = pg_catalog, public
      as $$
        select exists (
          select 1
          from public.user_profiles up
          where up.user_id = (select auth.uid())
            and up.status = 'active'
            and up.web_access_enabled
            and (
              up.is_system_admin
              or exists (
                select 1 from public.user_permissions permission
                where permission.user_id = up.user_id
                  and permission.permission = lower(btrim(permission_input))
              )
            )
        )
      $$;
    `);
    await db.exec(await readFile(new URL('../supabase/migrations/20260912100000_enforce_unified_crm_permissions.sql', import.meta.url), 'utf8'));
    await db.exec(`
      grant select on public.customers to authenticated;
      insert into public.customers(facebook_name) values ('Protected customer');
      insert into auth.users(id) values ('00000000-0000-4000-8000-000000000099');
      insert into public.user_profiles(user_id, username, status, web_access_enabled, is_system_admin)
      values ('00000000-0000-4000-8000-000000000099', 'normal-user', 'active', true, false);
      select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000099', false);
      set role authenticated;
    `);
    assert.equal((await db.query('select count(*)::int as count from public.customers')).rows[0].count, 0);

    await db.exec(`
      reset role;
      insert into public.app_permissions(permission, display_name, sort_order, is_active)
      values ('customers', 'Khách hàng', 1, true)
      on conflict (permission) do nothing;
      insert into public.user_permissions(user_id, permission)
      values ('00000000-0000-4000-8000-000000000099', 'customers');
      set role authenticated;
    `);
    assert.equal((await db.query('select count(*)::int as count from public.customers')).rows[0].count, 1);
  } finally {
    await db.close();
  }
});
