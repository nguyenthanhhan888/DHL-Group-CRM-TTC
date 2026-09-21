import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

function functionDefinition(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `Missing function source: ${signature}`);
  const end = source.indexOf('$function$;', start);
  assert.notEqual(end, -1, `Missing function terminator: ${signature}`);
  return source.slice(start, end + '$function$;'.length);
}

test('QA migrations execute and registration RPCs use the unified module permission', async () => {
  const db = new PGlite();
  try {
    await db.exec(await read('../tests/fixtures/crm-payment-baseline.sql'));
    await db.exec('alter table auth.users add column if not exists email text');
    for (const migration of [
      '../supabase/migrations/20260828182110_create_unified_user_access_foundation.sql',
      '../supabase/migrations/20260911074545_payment_lifecycle_revenue_business_logs.sql',
      '../supabase/migrations/20260912100000_enforce_unified_crm_permissions.sql',
      '../supabase/migrations/20260912143000_create_admin_expenses.sql',
      '../supabase/migrations/20260914113000_create_public_homepage_content.sql',
      '../supabase/migrations/20260916120000_qa_round1_core_stabilization.sql',
      '../supabase/migrations/20260916123000_safe_registration_orphan_archival.sql',
    ]) await db.exec(await read(migration));

    const approve = await read('../supabase/migrations/20260731110000_separate_registration_approval_from_payment_confirmation.sql');
    const legacy = await read('../supabase/migrations/20260804151000_sync_revenue_from_completed_payments.sql');
    const checkout = await read('../supabase/migrations/20260825160000_complete_registration_checkout_v3.sql');
    await db.exec(functionDefinition(approve, 'create or replace function public.approve_registration_request'));
    await db.exec(functionDefinition(legacy, 'create or replace function public.review_public_legacy_registration_request'));
    await db.exec(functionDefinition(checkout, 'create function public.admin_complete_awaiting_registration'));
    await db.exec(functionDefinition(checkout, 'create function public.admin_list_registration_requests'));

    await db.exec(await read('../supabase/migrations/20260916124500_unify_registration_rpc_permissions.sql'));

    for (const signature of [
      'public.approve_registration_request(bigint)',
      'public.review_public_legacy_registration_request(bigint,text,text)',
      'public.admin_complete_awaiting_registration(bigint,text)',
      'public.admin_cancel_awaiting_registration(bigint,text)',
      'public.admin_list_registration_requests(text)',
    ]) {
      const result = await db.query('select pg_get_functiondef(to_regprocedure($1)) as body', [signature]);
      assert.match(result.rows[0].body, /private\.assert_registration_permission\(\)/);
    }

    await db.exec(`
      insert into auth.users(id,email) values ('00000000-0000-4000-8000-000000000141','qa@example.test');
      insert into public.user_profiles(user_id,username,status,web_access_enabled,is_system_admin)
      values ('00000000-0000-4000-8000-000000000141','qa-registration','active',true,false);
      insert into public.app_permissions(permission,display_name,sort_order,is_active)
      values ('registration-requests','Hồ sơ Kiosk',1,true) on conflict(permission) do nothing;
      insert into public.user_permissions(user_id,permission)
      values ('00000000-0000-4000-8000-000000000141','registration-requests');
      select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000141',false);
    `);
    await assert.doesNotReject(() => db.query('select private.assert_registration_permission()'));
    await db.exec("delete from public.user_permissions where user_id='00000000-0000-4000-8000-000000000141'");
    await assert.rejects(() => db.query('select private.assert_registration_permission()'), (error) => error.code === '42501');

    await db.exec(`
      insert into public.app_permissions(permission,display_name,sort_order,is_active)
      values ('reports','Báo cáo',2,true) on conflict(permission) do nothing;
      insert into public.user_permissions(user_id,permission)
      values ('00000000-0000-4000-8000-000000000141','reports');
    `);
    await assert.doesNotReject(() => db.query('select public.get_current_financial_kpis()'));
    await assert.doesNotReject(() => db.query('select public.get_registration_operations_summary()'));
    await db.exec("delete from public.user_permissions where user_id='00000000-0000-4000-8000-000000000141'");
    await assert.rejects(() => db.query('select public.get_current_financial_kpis()'), (error) => error.code === '42501');
    await assert.rejects(() => db.query('select public.get_registration_operations_summary()'), (error) => error.code === '42501');
  } finally {
    await db.close();
  }
});
