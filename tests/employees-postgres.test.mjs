import { before, after, beforeEach, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const migrationPath = '../supabase/migrations/20260921221551_independent_employees_expense_attribution.sql';
const read = p => readFile(new URL(p, import.meta.url), 'utf8');
let db, beforeRows, beforeFinance, beforeDashboard, afterFinance, migration, mappedId;
const admin = '00000000-0000-4000-8000-000000000701';
const staff = '00000000-0000-4000-8000-000000000702';
const named = '00000000-0000-4000-8000-000000000703';
const ambiguous = '00000000-0000-4000-8000-000000000704';
const deleted = '00000000-0000-4000-8000-000000000705';
const sameName = '00000000-0000-4000-8000-000000000706';
async function rejects(run, pattern) {
  await db.exec('savepoint expected_error');
  try { await assert.rejects(run, pattern); } finally { await db.exec('rollback to savepoint expected_error; release savepoint expected_error'); }
}
const scalar = async (sql, values = []) => Object.values((await db.query(sql, values)).rows[0])[0];
const rpc = (name, values = []) => scalar(`select public.${name}(${values.map((_, i) => `$${i+1}`).join(',')})`, values);
async function actor(id) { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]); await db.exec('set role authenticated'); }
const person = (values = {}) => rpc('save_employee',[values.id || null, values.name || 'Nhân viên độc lập', values.phone || null, values.job || null, values.start || null, values.status || 'active', values.notes || null]);
const expense = (values = {}) => rpc('save_employee_expense',[values.id || null, values.category || 'other', values.amount ?? 100000, values.date || '2026-09-22', values.employeeId || null, values.period || null, 'cash', values.note || null]);
before(async () => {
  db = new PGlite();
  await db.exec(await read('./fixtures/crm-payment-baseline.sql'));
  await db.exec('alter table auth.users add column if not exists email text');
  for (const name of [
    '20260828182110_create_unified_user_access_foundation','20260911074545_payment_lifecycle_revenue_business_logs',
    '20260912100000_enforce_unified_crm_permissions','20260912143000_create_admin_expenses','20260914113000_create_public_homepage_content',
    '20260916120000_qa_round1_core_stabilization','20260916123000_safe_registration_orphan_archival',
    '20260916150000_fix_status_read_permissions_and_kiosk_filters','20260916151000_manage_expense_categories_and_workspace_kpis',
    '20260916152000_refine_business_journal',
  ]) await db.exec(await read(`../supabase/migrations/${name}.sql`));
  for (const [id,username,name,isAdmin] of [[admin,'admin','Admin QA',true],[staff,'allowed','Người quản lý',false],[named,'named','Tên trùng',false],[ambiguous,'only-username',null,false],[deleted,'deleted','Tên lịch sử',false],[sameName,'second-named','Tên trùng',false]]) {
    await db.query('insert into auth.users(id) values($1)',[id]);
    await db.query('insert into public.user_profiles(user_id,username,display_name,status,web_access_enabled,is_system_admin) values($1,$2,$3,\'active\',true,$4)',[id,username,name,isAdmin]);
  }
  await db.query("insert into public.user_permissions(user_id,permission) values($1,'expenses')",[staff]);
  await db.exec("insert into public.categories(id,name,is_active) values(1,'QA',true); insert into public.business_types(id,category_id,name,price_per_month,is_active) values(1,1,'QA',100000,true)");
  const customer=await scalar("insert into public.customers(facebook_name,phone,status) values('QA revenue','0900000000','active') returning id");
  const kiosk=await scalar("insert into public.kiosks(customer_id,facebook_name,business_type_id,category_id,start_date,end_date,status) values($1,'QA revenue kiosk',1,1,'2026-01-01','2026-12-31','active') returning id",[customer]);
  const payment=await scalar("insert into public.payments(customer_id,kiosk_id,months,price_per_month,total_amount,created_at) values($1,$2,1,12000000,12000000,'2026-09-17T03:00:00Z') returning id",[customer,kiosk]);
  await db.exec("select set_config('app.payment_workflow_action','confirm',false)");
  await db.query("update public.payments set payment_status='completed',confirmed_at='2026-09-17T03:00:00Z' where id=$1",[payment]);
  await actor(admin);
  for (const [id,amount,category,period] of [[null,450000,'advertising',null],[named,5000000,'salary','2026-09-01'],[named,200000,'bonus',null],[ambiguous,300000,'bonus',null],[deleted,150000,'bonus',null],[sameName,250000,'bonus',null]]) {
    if(id===ambiguous){
      // An older import without a save audit: keep its visible username, without inventing an Employee.
      await db.exec('reset role');
      await db.query("insert into public.expenses(category,category_id,amount,expense_date,employee_user_id,payment_method,created_by) select $1,id,$2,'2026-09-17',$3,'cash',$4 from public.expense_categories where code=$1",[category,amount,id,admin]);
      await actor(admin);
    } else await rpc('save_expense',[null,category,amount,'2026-09-17',id,period,'cash',null]);
  }
  await rpc('archive_expense',[3,'QA archived history']);
  await db.exec('reset role');
  await db.query('delete from public.user_profiles where user_id=$1',[deleted]);
  beforeRows = (await db.query('select * from public.expenses order by id')).rows;
  await actor(admin);
  beforeFinance = await rpc('get_expenses_data');
  beforeDashboard = await rpc('get_business_events',['dashboard']);
  await db.exec('reset role');
  migration = await read(migrationPath);
  await db.exec(migration);
  await actor(admin);
  afterFinance = await rpc('get_employee_expenses_data');
  mappedId = afterFinance.rows.find(row => row.employee_user_id === named).employee_id;
  await db.exec('reset role');
  await writeFile(new URL('../docs/qa/employees-v1/migration-integrity.json',import.meta.url),JSON.stringify({
    fixture:'Synthetic mixed attribution fixture; production baseline is separately recorded in production-before.json',
    before:{count:beforeRows.length,total:beforeRows.reduce((n,r)=>n+Number(r.amount),0),activeTotal:beforeFinance.totalExpense,revenue:beforeFinance.totalRevenue,netProfit:beforeFinance.netProfit},
    after:{count:Number(await scalar('select count(*) from public.expenses')),total:Number(await scalar('select sum(amount) from public.expenses')),activeTotal:afterFinance.totalExpense,revenue:afterFinance.totalRevenue,netProfit:afterFinance.netProfit},
    employees:Number(await scalar('select count(*) from public.employees')),mappedExpenses:Number(await scalar('select count(*) from public.expenses where employee_id is not null')),
    ambiguous:afterFinance.rows.filter(r=>r.attribution_state==='legacy').map(r=>({id:r.id,name:r.employee_name})),
  },null,2)+'\n');
});
after(async()=>db?.close());
beforeEach(async()=>{ await db.exec('reset role; begin'); await actor(admin); });
afterEach(async()=>{ await db.exec('reset role; rollback'); });

test('migration preserves every original expense field, totals, revenue and Reports summary',async()=>{
  await db.exec('reset role');
  const afterRows=(await db.query('select * from public.expenses order by id')).rows.map(({employee_id,employee_name_snapshot,...old})=>old);
  assert.deepEqual(afterRows,beforeRows);
  for(const key of ['totalAmount','totalExpense','totalRevenue','netProfit','totalRows']) assert.equal(afterFinance[key],beforeFinance[key],key);
  await actor(admin);
  assert.equal((await rpc('get_expense_report_summary')).totalExpense,afterFinance.totalExpense);
  assert.deepEqual(await rpc('get_business_events',['dashboard']),beforeDashboard);
});
test('backfill uses UUIDs, preserves same-name people separately and never guesses username-only/deleted people',async()=>{
  const rows=(await rpc('get_employee_expenses_data',[null,null,null,null,true])).rows;
  assert.equal(new Set(rows.filter(r=>r.employee_user_id===named).map(r=>r.employee_id)).size,1);
  assert.notEqual(rows.find(r=>r.employee_user_id===sameName).employee_id,mappedId);
  assert.equal(rows.find(r=>r.employee_user_id===ambiguous).employee_id,null);
  const historical=rows.find(r=>Number(r.amount)===150000);
  assert.equal(historical.employee_id,null); assert.equal(historical.employee_name,'Tên lịch sử');
  assert.equal(rows.find(r=>Number(r.amount)===450000).attribution_state,'unassigned');
  const people=(await rpc('get_employees_data',[null,null,true])).rows;
  assert.equal(people.length,2);assert.ok(people.every(p=>p.archived_at));
});
test('migration reruns without duplicate employees or reassigning an intentionally cleared expense',async()=>{
  const created=await person(); const saved=(await expense({employeeId:created.id})).expense;
  await expense({id:saved.id,employeeId:null});
  await db.exec('reset role; commit');
  await db.exec(migration);
  assert.equal(Number(await scalar('select count(*) from public.employees')),3);
  assert.equal(await scalar('select employee_id from public.expenses where id=$1',[saved.id]),null);
  // Explicit cleanup leaves baseline rows available for other tests.
  await db.query('delete from public.expenses where id=$1',[saved.id]);
  await db.exec('begin');
});
test('Employee create/edit requires no website account and emits business events',async()=>{
  await db.exec('reset role');const users=await scalar('select count(*) from auth.users');await actor(admin);
  const created=await person({name:'Nguyễn Văn A',job:'Vận hành'});
  const edited=await person({id:created.id,name:'Nguyễn Văn B',phone:'0900000000',start:'2026-09-22'});
  assert.equal(edited.full_name,'Nguyễn Văn B');
  const events=(await rpc('get_business_events',['logs',null,null,'employee'])).rows;
  assert.ok(events.some(e=>e.title==='Đã tạo nhân viên Nguyễn Văn A'));
  assert.ok(events.some(e=>e.title==='Đã cập nhật nhân viên Nguyễn Văn B'));
  await db.exec('reset role');assert.equal(await scalar('select count(*) from auth.users'),users);
});
test('left/reactivate/archive/restore are explicit, idempotent, and never delete Employee',async()=>{
  const p=await person();assert.equal((await rpc('set_employee_lifecycle',[p.id,'left'])).employment_status,'left');
  assert.equal((await rpc('set_employee_lifecycle',[p.id,'reactivate'])).employment_status,'active');
  assert.ok((await rpc('set_employee_lifecycle',[p.id,'archive'])).archived_at);
  assert.ok((await rpc('set_employee_lifecycle',[p.id,'archive'])).archived_at);
  await rejects(()=>person({id:p.id}),/Khôi phục/);
  await rejects(()=>rpc('set_employee_lifecycle',[p.id,'left']),/Khôi phục/);
  assert.equal((await rpc('set_employee_lifecycle',[p.id,'restore'])).archived_at,null);
  await db.exec('reset role');await rejects(()=>db.query('delete from public.employees where id=$1',[p.id]),/không xóa/);
});
test('Expense can use Employee or remain unassigned and assignment changes explicitly',async()=>{
  const a=await person({name:'A'}),b=await person({name:'B'});
  const linked=(await expense({employeeId:a.id})).expense,empty=(await expense()).expense;
  assert.equal(linked.employee_name_snapshot,'A'); assert.equal(linked.employee_user_id,null);assert.equal(empty.employee_id,null);
  const changed=(await expense({id:linked.id,employeeId:b.id})).expense;assert.equal(changed.employee_name_snapshot,'B');
  assert.equal((await expense({id:linked.id})).expense.employee_name_snapshot,null);
});
test('renaming/leaving/archiving retains expense snapshot and linked inactive Employee stays editable',async()=>{
  const p=await person({name:'Tên ban đầu'});const e=(await expense({employeeId:p.id})).expense;
  await person({id:p.id,name:'Tên mới'});
  await rpc('set_employee_lifecycle',[p.id,'left']);
  await rejects(()=>expense({employeeId:p.id}),/Chỉ chọn nhân viên/);
  await rpc('set_employee_lifecycle',[p.id,'archive']);
  const edited=(await expense({id:e.id,employeeId:p.id,note:'Sửa ghi chú'})).expense;
  assert.equal(edited.employee_id,p.id);assert.equal(edited.employee_name_snapshot,'Tên ban đầu');
  const row=(await rpc('get_employee_expenses_data',[null,null,null,p.id])).rows[0];
  assert.equal(row.employee_name,'Tên ban đầu');assert.equal(row.employee_current_name,'Tên mới');assert.ok(row.employee_archived_at);
});
test('salary requirements and duplicate warning now use Employee, with dates and amounts unchanged',async()=>{
  const p=await person();await rejects(()=>expense({category:'salary',period:'2026-09-01'}),/Lương cần/);
  const a=await expense({category:'salary',employeeId:p.id,period:'2026-09-01'});assert.equal(a.duplicateSalary,false);
  assert.equal(await rpc('check_employee_salary_duplicate',[p.id,'2026-09-01',null]),true);
  assert.equal((await expense({category:'salary',employeeId:p.id,period:'2026-09-01'})).duplicateSalary,true);
  assert.equal(await rpc('check_employee_salary_duplicate',[p.id,'2026-10-01',null]),false);
});
test('historical unmapped expense can be edited without removing original attribution',async()=>{
  const row=afterFinance.rows.find(r=>r.employee_user_id===ambiguous);
  const edited=(await expense({id:row.id,category:row.category,amount:row.amount,date:row.expense_date})).expense;
  assert.equal(edited.employee_user_id,ambiguous);assert.equal(edited.employee_id,null);
});
test('unmapped legacy salary remains editable with its original UUID and month',async()=>{
  const row=afterFinance.rows.find(r=>r.employee_user_id===ambiguous);
  await db.exec('reset role');
  await db.query("update public.expenses set category='salary',category_id=(select id from public.expense_categories where code='salary'),salary_period='2026-09-01' where id=$1",[row.id]);
  await actor(admin);
  const saved=(await expense({id:row.id,category:'salary',period:'2026-09-01',amount:row.amount,date:row.expense_date,note:'Bổ sung ghi chú'})).expense;
  assert.equal(saved.employee_id,null);assert.equal(saved.employee_user_id,ambiguous);assert.equal(saved.employee_name_snapshot,'only-username');assert.equal(saved.salary_period,'2026-09-01');
});
test('Employee filter includes archived historical staff and changes only expense subset',async()=>{
  const all=await rpc('get_employee_expenses_data');const filtered=await rpc('get_employee_expenses_data',[null,null,null,mappedId]);
  assert.equal(filtered.totalRows,1);assert.equal(filtered.totalExpense,5000000);assert.equal(filtered.totalRevenue,all.totalRevenue);
  assert.ok(filtered.employees.some(e=>e.id===mappedId && e.archived_at));
});
test('deleting a legacy website profile retains independent Employee, salary and historical name',async()=>{
  await db.exec('reset role');
  const original=(await db.query('select * from public.expenses where employee_user_id=$1 order by id',[named])).rows;
  await db.query('delete from public.user_profiles where user_id=$1',[named]);
  const saved=(await db.query('select * from public.expenses where employee_id=$1 order by id',[mappedId])).rows;
  assert.equal(saved.length,original.length);
  for(let i=0;i<saved.length;i++){
    assert.equal(saved[i].employee_user_id,null);
    for(const field of ['id','employee_id','employee_name_snapshot','amount','expense_date','category','salary_period','archived_at'])assert.deepEqual(saved[i][field],original[i][field],field);
  }
  await actor(admin);
  const row=(await rpc('get_employee_expenses_data',[null,null,null,mappedId])).rows[0];
  assert.equal(row.employee_name,'Tên trùng');assert.equal(row.attribution_state,'linked');
});
test('website account creation does not create Employee and unmapped attribution survives profile deletion',async()=>{
  await db.exec('reset role');
  const count=await scalar('select count(*) from public.employees');
  const id='00000000-0000-4000-8000-000000000707';
  await db.query('insert into auth.users(id) values($1)',[id]);
  await db.query("insert into public.user_profiles(user_id,username,display_name,status) values($1,'new-user','Một người dùng mới','active')",[id]);
  assert.equal(await scalar('select count(*) from public.employees'),count);
  await db.query('delete from public.user_profiles where user_id=$1',[ambiguous]);
  await actor(admin);
  const row=(await rpc('get_employee_expenses_data')).rows.find(r=>Number(r.amount)===300000);
  assert.equal(row.employee_id,null);assert.equal(row.employee_name,'only-username');assert.equal(row.attribution_state,'legacy');
});
test('granted expenses permission succeeds, revoke denies all Employee/Expense RPC and RLS reads',async()=>{
  await actor(staff);const p=await person();await expense({employeeId:p.id});
  await db.exec('reset role');await db.query("delete from public.user_permissions where user_id=$1 and permission='expenses'",[staff]);await actor(staff);
  for(const run of [()=>person(),()=>rpc('get_employees_data'),()=>rpc('set_employee_lifecycle',[p.id,'archive']),()=>rpc('get_employee_expenses_data'),()=>expense(),()=>rpc('check_employee_salary_duplicate',[p.id,'2026-09-01',null])]) await rejects(run,/Không có quyền/);
  assert.equal(Number(await scalar('select count(*) from public.employees')),0);assert.equal(Number(await scalar('select count(*) from public.expenses')),0);
  await db.exec('reset role');await db.query("insert into public.user_permissions(user_id,permission) values($1,'expenses')",[staff]);await actor(staff);await assert.doesNotReject(()=>person());
});
test('anonymous and raw table mutations are denied; old user-based Expense mutation is retired',async()=>{
  await rejects(()=>db.exec("insert into public.employees(full_name) values('Bypass')"),/permission denied/);
  await rejects(()=>rpc('save_expense',[null,'other',100,'2026-09-22',null,null,'cash',null]),/permission denied/);
  await db.exec('reset role; set role anon');await rejects(()=>rpc('get_employees_data'),/permission denied/);await rejects(()=>person(),/permission denied/);
});
test('locked/disabled website identity loses Employee access regardless of a stale granted permission',async()=>{
  await db.exec('reset role');await db.query("update public.user_profiles set web_access_enabled=false where user_id=$1",[staff]);await actor(staff);
  await rejects(()=>person(),/Không có quyền/);
});
test('Employee events appear in Logs without changing Dashboard Recent Activity',async()=>{
  const original = await rpc('get_business_events',['dashboard']);
  await person({name:'Không đưa vào Dashboard'});
  const logs=await rpc('get_business_events',['logs',null,null,'employee']);assert.ok(logs.total>0);
  const dashboard=await rpc('get_business_events',['dashboard']);assert.deepEqual(dashboard,original);
});
