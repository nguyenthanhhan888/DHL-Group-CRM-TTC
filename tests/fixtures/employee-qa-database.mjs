// Local Postgres only. Replays repository migrations; never connects to Supabase.
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
const read = path => readFile(new URL(path, import.meta.url), 'utf8');
export async function createEmployeeQaDatabase() {
  const db = new PGlite();
  await db.exec(await read('./crm-payment-baseline.sql'));
  await db.exec('alter table auth.users add column if not exists email text');
  for (const name of [
    '20260828182110_create_unified_user_access_foundation','20260911074545_payment_lifecycle_revenue_business_logs',
    '20260912100000_enforce_unified_crm_permissions','20260912143000_create_admin_expenses','20260914113000_create_public_homepage_content',
    '20260916120000_qa_round1_core_stabilization','20260916123000_safe_registration_orphan_archival',
    '20260916150000_fix_status_read_permissions_and_kiosk_filters','20260916151000_manage_expense_categories_and_workspace_kpis',
    '20260916152000_refine_business_journal',
  ]) await db.exec(await read(`../../supabase/migrations/${name}.sql`));
  const id='00000000-0000-4000-8000-000000000801';
  await db.query('insert into auth.users(id) values($1)',[id]);
  await db.query("insert into public.user_profiles(user_id,username,display_name,status,web_access_enabled,is_system_admin) values($1,'qa-local','Người kiểm tra CRM','active',true,false)",[id]);
  await db.query("insert into public.user_permissions(user_id,permission) values($1,'expenses'),($1,'logs')",[id]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);
  await db.exec('set role authenticated');
  await db.exec("select public.save_expense(null,'advertising',450000,'2026-09-17',null,null,'cash','Chi phí quảng cáo chưa gắn nhân viên')");
  await db.exec('reset role');
  const baseline=(await db.query("select count(*)::int count,sum(amount)::numeric total from public.expenses")).rows[0];
  await db.exec(await read('../../supabase/migrations/20260921221551_independent_employees_expense_attribution.sql'));
  const migrated=(await db.query("select count(*)::int count,sum(amount)::numeric total,(select count(*)::int from public.employees) employees from public.expenses")).rows[0];
  await db.exec('set role authenticated');
  const scalar=async(sql,p=[])=>Object.values((await db.query(sql,p)).rows[0])[0];
  const people=[];
  for (const [name,phone,job,start,notes] of [['Nguyễn An','0900000001','Vận hành CRM','2025-02-01','Phụ trách hỗ trợ khách hàng.'],['Trần Bình','0900000002','Nội dung','2024-06-15','Đã bàn giao công việc.'],['Lê Chi',null,'Cộng tác viên','2023-03-01','Lưu trữ hồ sơ, giữ lịch sử khoản chi.']]) {
    people.push(await scalar("select public.save_employee(null,$1,$2,$3,$4,'active',$5)",[name,phone,job,start,notes]));
  }
  await scalar("select public.save_employee_expense(null,'salary',5000000,'2026-09-17',$1,'2026-09-01','bank_transfer','Lương tháng 9')",[people[1].id]);
  await scalar("select public.save_employee_expense(null,'bonus',250000,'2026-09-17',$1,null,'cash','Thưởng hỗ trợ')",[people[2].id]);
  await scalar("select public.set_employee_lifecycle($1,'left')",[people[1].id]);
  await scalar("select public.set_employee_lifecycle($1,'archive')",[people[2].id]);
  await db.exec('reset role; begin; set role authenticated');
  return { db, id, baseline, migrated };
}
