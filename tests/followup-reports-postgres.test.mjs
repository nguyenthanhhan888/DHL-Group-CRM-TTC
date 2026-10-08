import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createPermissionQaDatabase,asQaUser,qaUsers} from './fixtures/permission-qa-database.mjs';
import {seedFollowupReports} from './fixtures/followup-qa-seed.mjs';
let db;
before(async()=>{ db=await createPermissionQaDatabase();await seedFollowupReports(db); });
after(async()=>db?.close());
const report=async(from,to,extra={},user='admin')=>(await asQaUser(db,user,'select get_reports_data_filtered(p_report_type=>$1,p_start_date=>$2,p_end_date=>$3,p_search=>$4,p_customer_id=>$5,p_payment_status=>$6) as data',['revenue',from,to,extra.search||null,extra.customerId||null,extra.status||null])).rows[0].data;
for(const [title,from,to,total,count] of [
 ['one day','2026-08-01','2026-08-01',100,1],
 ['August Vietnam half-open boundaries','2026-08-01','2026-08-31',350,3],
 ['historical month','2025-06-01','2025-06-30',1000,1],
 ['previous full year','2025-01-01','2025-12-31',1500,2],
 ['cross month','2026-07-31','2026-08-01',170,2],
 ['cross year','2025-12-31','2026-06-15',600,1],
 ['arbitrary range','2025-08-15','2026-03-20',0,0],
 ['current year-to-date fixture','2026-01-01','2026-10-03',2320,7],
]) test(`report ${title}: totals, rows and groups agree`,async()=>{
 const r=await report(from,to);assert.equal(Number(r.summary.totalRevenue),total);assert.equal(r.pagination.totalRows,count);assert.equal(r.rows.length,count);
 assert.equal(r.groups.monthly.reduce((n,x)=>n+Number(x.totalAmount),0),total);
 assert.equal(r.groups.businessTypes.reduce((n,x)=>n+Number(x.totalAmount),0),total);
});
test('revenue ignores pending/cancelled/unconfirmed completed and archived expense',async()=>{
 const r=await report('2026-08-01','2026-08-31');
 const e=(await asQaUser(db,'admin',"select get_expense_report_summary('2026-08-01','2026-08-31') as data")).rows[0].data;
 assert.equal(Number(e.totalExpense),75);assert.equal(Number(r.summary.totalRevenue)-Number(e.totalExpense),275);
 assert.deepEqual(r.groups.monthly.map(x=>x.key),['2026-08']);
});
test('search and advanced filters are additive before aggregate/page/export data',async()=>{
 const r=await report('2026-08-01','2026-08-31',{search:'200',customerId:1});assert.equal(r.rows.length,1);assert.equal(Number(r.summary.totalRevenue),200);assert.equal(Number(r.groups.monthly[0].totalAmount),200);
 const empty=await report('2026-08-01','2026-08-31',{search:'not present'});assert.equal(empty.rows.length,0);assert.equal(Number(empty.summary.totalRevenue),0);
 const pending=await report('2026-08-01','2026-08-31',{status:'pending'});assert.equal(Number(pending.summary.totalRevenue),0);
});
test('literal wildcard search does not become SQL wildcard and inverted interval is denied',async()=>{
 assert.equal((await report('2026-08-01','2026-08-31',{search:'%'})).rows.length,0);
 await assert.rejects(()=>report('2026-08-31','2026-08-01'));
});
test('new read-only report RPC preserves canonical permissions and denies zero/stale/disabled/anon',async()=>{
 for(const user of ['zero','disabled','legacy']) await assert.rejects(()=>report('2026-08-01','2026-08-31',{},user),e=>e.code==='42501');
 await db.query("insert into user_permissions(user_id,permission) values($1,'reports')",[qaUsers.selective]);
 assert.equal((await report('2026-08-01','2026-08-31',{},'selective')).rows.length,3);
 await db.query('delete from user_permissions where user_id=$1',[qaUsers.selective]);
 await assert.rejects(()=>report('2026-08-01','2026-08-31',{},'selective'),e=>e.code==='42501');
 await assert.rejects(()=>report('2026-08-01','2026-08-31',{},null),e=>e.code==='42501');
});
test('all report tabs accept the same period/search without changing old RPC',async()=>{
 for(const tab of ['overview','kiosks','customers','reconciliation','categories']) await assert.doesNotReject(()=>asQaUser(db,'admin','select get_reports_data_filtered(p_report_type=>$1,p_start_date=>$2,p_end_date=>$3,p_search=>$4)',[tab,'2026-08-01','2026-08-31','Alpha']));
 const before=(await asQaUser(db,'admin',"select get_reports_data(p_report_type=>'revenue',p_start_date=>'2026-08-01',p_end_date=>'2026-08-31') as data")).rows[0].data;
 assert.equal(Number(before.summary.totalRevenue),350);
});
