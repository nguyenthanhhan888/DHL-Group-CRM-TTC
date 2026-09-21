import { after, afterEach, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

let db;
const admin = '00000000-0000-4000-8000-000000000301';
const employee = '00000000-0000-4000-8000-000000000302';
const normal = '00000000-0000-4000-8000-000000000303';
const permitted = '00000000-0000-4000-8000-000000000304';
const scalar = async (sql, params = []) => Object.values((await db.query(sql, params)).rows[0])[0];
const rpc = (name, values = []) => scalar(`select public.${name}(${values.map((_, index) => `$${index + 1}`).join(',')})`, values);

before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('./fixtures/crm-payment-baseline.sql', import.meta.url), 'utf8'));
  await db.exec('alter table auth.users add column email text');
  await db.exec(await readFile(new URL('../supabase/migrations/20260828182110_create_unified_user_access_foundation.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../supabase/migrations/20260912143000_create_admin_expenses.sql', import.meta.url), 'utf8'));
});

after(async () => db?.close());

beforeEach(async () => {
  await db.exec(`reset role;
    delete from public.expenses;
    delete from public.user_permissions where user_id in ('${admin}','${employee}','${normal}','${permitted}');
    delete from public.user_profiles where user_id in ('${admin}','${employee}','${normal}','${permitted}');
    delete from auth.users where id in ('${admin}','${employee}','${normal}','${permitted}');`);
  await db.query('insert into auth.users(id) values($1),($2),($3),($4)', [admin, employee, normal, permitted]);
  await db.query(`insert into public.user_profiles(user_id,username,display_name,status,web_access_enabled,is_system_admin)
    values ($1,'expense-admin','Expense Admin','active',true,true),
      ($2,'employee-one','Nhân viên Một','active',true,false),
      ($3,'normal-user','Normal User','active',true,false),
      ($4,'expense-user','Expense User','active',true,false)`, [admin, employee, normal, permitted]);
  await db.query("insert into public.user_permissions(user_id,permission) values($1,'expenses')", [permitted]);
  await setActor(admin);
});

afterEach(async () => {
  await db.exec('reset role');
});

async function setActor(userId) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [userId]);
  await db.exec('set role authenticated');
}

async function save({ id = null, category = 'advertising', amount = 1000000, date = '2026-09-12', employeeId = null, period = null, method = 'bank_transfer', note = 'QA' } = {}) {
  return rpc('save_expense', [id, category, amount, date, employeeId, period, method, note]);
}

test('create, edit and archive expense produce one business log each', async () => {
  const created = await save();
  assert.equal(Number(created.expense.amount), 1000000);
  const edited = await save({ id: created.expense.id, amount: 1250000, note: 'Điều chỉnh ngân sách' });
  assert.equal(Number(edited.expense.amount), 1250000);
  await rpc('archive_expense', [created.expense.id, 'Nhập nhầm']);
  assert.equal(await scalar('select count(*)::int from public.expenses where archived_at is null'), 0);
  await db.exec('reset role');
  assert.equal(await scalar("select count(*)::int from public.audit_logs where action in ('create_expense','update_expense','archive_expense')"), 3);
});

test('amount at or below zero is rejected by RPC and table constraint', async () => {
  await assert.rejects(() => save({ amount: 0 }), /lớn hơn 0/);
  await assert.rejects(() => save({ amount: -1 }), /lớn hơn 0/);
  await db.exec('reset role');
  await assert.rejects(
    () => db.query("insert into public.expenses(category,amount,expense_date,payment_method,created_by) values('advertising',0,'2026-09-12','cash',$1)", [admin]),
    /expenses_amount_positive_check/,
  );
});

test('salary requires employee and month while duplicate salary remains a warning', async () => {
  await assert.rejects(() => save({ category: 'salary' }), /nhân viên và kỳ lương/i);
  const first = await save({ category: 'salary', amount: 5000000, employeeId: employee, period: '2026-09-01' });
  assert.equal(first.duplicateSalary, false);
  assert.equal(await rpc('check_duplicate_salary_expense', [employee, '2026-09-01', null]), true);
  const supplement = await save({ category: 'salary', amount: 500000, employeeId: employee, period: '2026-09-01', note: 'Bổ sung' });
  assert.equal(supplement.duplicateSalary, true);
  assert.equal(await scalar("select count(*)::int from public.expenses where category='salary'"), 2);
});

test('RLS and RPC enforce expense permission while System Admin retains access', async () => {
  await save();
  await setActor(normal);
  assert.equal(await scalar('select count(*)::int from public.expenses'), 0);
  await assert.rejects(() => rpc('get_expenses_data'), /Không có quyền/);
  await setActor(permitted);
  assert.equal(await scalar('select count(*)::int from public.expenses'), 1);
  assert.equal((await rpc('get_expenses_data')).totalRows, 1);
  await setActor(admin);
  assert.equal((await rpc('get_expenses_data')).totalRows, 1);
});

test('expense report uses the inclusive date filter without mutating payments', async () => {
  await db.exec('reset role');
  const paymentCount = await scalar('select count(*)::int from public.payments');
  await setActor(admin);
  await save({ amount: 100000, date: '2026-08-31' });
  await save({ amount: 200000, date: '2026-09-01' });
  await save({ amount: 300000, date: '2026-09-30' });
  await save({ amount: 400000, date: '2026-10-01' });
  const summary = await rpc('get_expense_report_summary', ['2026-09-01', '2026-09-30']);
  assert.equal(Number(summary.totalExpense), 500000);
  await db.exec('reset role');
  assert.equal(await scalar('select count(*)::int from public.payments'), paymentCount);
});
