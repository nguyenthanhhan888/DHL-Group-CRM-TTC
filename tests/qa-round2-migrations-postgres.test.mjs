import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const user = '00000000-0000-4000-8000-000000000421';
const employee = '00000000-0000-4000-8000-000000000422';

test('Round 2 migrations execute and enforce status, expense category and journal boundaries', async () => {
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
      '../supabase/migrations/20260916150000_fix_status_read_permissions_and_kiosk_filters.sql',
      '../supabase/migrations/20260916151000_manage_expense_categories_and_workspace_kpis.sql',
      '../supabase/migrations/20260916152000_refine_business_journal.sql',
    ]) await db.exec(await read(migration));

    await db.query('insert into auth.users(id) values($1),($2)', [user, employee]);
    await db.query(`insert into public.user_profiles(user_id,username,display_name,status,web_access_enabled,is_system_admin)
      values($1,'round2-user','Round 2 Admin','active',true,false),($2,'round2-employee','Nhân viên QA','active',true,false)`, [user, employee]);
    for (const permission of ['customers','kiosks','expenses','logs']) {
      await db.query('insert into public.user_permissions(user_id,permission) values($1,$2)', [user, permission]);
    }
    await db.exec(`select set_config('request.jwt.claim.sub','${user}',false); set role authenticated;`);

    await assert.doesNotReject(() => db.query('select public.get_customer_status_data(p_customer_id=>null)'));
    await assert.doesNotReject(() => db.query('select public.get_kiosk_status_data(p_status=>\'active\')'));
    await assert.rejects(() => db.query('select * from public.settings'), /permission denied|row-level security/i);

    const createdCategory = (await db.query("select public.save_expense_category(null,'Vận hành') value")).rows[0].value;
    const expense = (await db.query("select public.save_expense(null,$1,100000,'2026-09-16',$2,null,'cash','QA') value", [createdCategory.code, employee])).rows[0].value.expense;
    await db.query("select public.save_expense_category($1,'Vận hành chung')", [createdCategory.id]);
    await db.query('select public.archive_expense_category($1)', [createdCategory.id]);
    await db.exec('reset role');
    assert.equal(Number((await db.query('select count(*) count from public.expenses where id=$1 and category_id=$2', [expense.id, createdCategory.id])).rows[0].count), 1);

    await db.exec(`insert into public.audit_logs(actor_name,module,entity,record_id,action,reason,legacy_log_id,before,after)
      values('Admin','Kiosk','kiosks','1','update','Cập nhật Kiosk',null,'{"facebook_name":"Cũ"}','{"facebook_name":"Mới"}'),
        ('System','Kiosk','kiosks','1','update','Mirrored from legacy logs',99,'{"facebook_name":"Cũ"}','{"facebook_name":"Mới"}');`);
    await db.exec(`select set_config('request.jwt.claim.sub','${user}',false); set role authenticated;`);
    const journal = (await db.query("select public.get_business_events('logs',null,null,'update',null,null,null,1,20) value")).rows[0].value;
    assert.equal(journal.rows.some((row) => row.title.includes('Mirrored')), false);
    assert.equal(journal.rows.some((row) => row.actor_name === 'Admin'), true);
  } finally {
    await db.close();
  }
});
