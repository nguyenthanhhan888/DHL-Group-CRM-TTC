import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createPermissionQaDatabase,asQaUser,qaUsers} from './fixtures/permission-qa-database.mjs';
import {seedFollowupReports} from './fixtures/followup-qa-seed.mjs';
import {reportPeriod} from '../src/utils/reportPeriod.js';
let db,user='admin',calls=[];
globalThis.localStorage=new Proxy({}, {get(){throw new Error('Persistent notifications must not use localStorage');}});
globalThis.window={DHL_CONFIG:{supabaseUrl:'https://qa.invalid',supabaseAnonKey:'qa'},supabase:{createClient:()=>({
 auth:{getSession:async()=>({data:{session:user?{user:{id:qaUsers[user]}}:null}})},
 rpc:async(name,args)=>{calls.push({name,args});try {const keys=Object.keys(args||{}),sql=`select public.${name}(${keys.map((k,i)=>`${k}=>$${i+1}`).join(',')}) as data`;return {data:(await asQaUser(db,user,sql,keys.map(k=>args[k]))).rows[0].data,error:null};}catch(error){return {data:null,error};}}
})}};
const {ReportService}=await import('../src/services/ReportService.js');
const {AdminNotificationService}=await import('../src/services/AdminNotificationService.js');
before(async()=>{const browserWindow=globalThis.window;delete globalThis.window;db=await createPermissionQaDatabase();globalThis.window=browserWindow;await seedFollowupReports(db);await db.exec("select setval('kiosks_id_seq',50)");});
after(async()=>db?.close());
const rpc=async(name,args=[]) => Object.values((await asQaUser(db,'admin',`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')})`,args)).rows[0])[0];
const kiosk=id=>({facebook_name:'Notification TEST '+id,facebook_id:id,facebook_link:'https://facebook.com/'+id,business_type_id:1,months:1});
let first,second;
test('default Reports uses Vietnam YTD and current-month context, no runtime-only KPI RPC',async()=>{
 calls=[];const r=(await ReportService.getReportData('revenue')).data;const p=reportPeriod();
 assert.equal(r.financial.period.mode,'ytd');assert.deepEqual(r.financial.period.selected,p.selected);
 assert.match(r.financial.period.labels[0],new RegExp(p.year));assert.match(r.financial.period.labels[3],/Lợi nhuận ròng năm/);
 assert.ok(calls.every(x=>x.name!=='get_current_financial_kpis'));
 assert.equal(calls.filter(x=>x.name==='get_reports_data_filtered').length,2);
});
test('historical month KPI annual source is selected year; monthly revenue-expense-net reconcile',async()=>{
 const r=(await ReportService.getReportData('revenue',{startDate:'2025-06-01',endDate:'2025-06-30'})).data;
 assert.deepEqual(r.financial.values,[1500,1000,300,700]);assert.deepEqual(r.financial.period.labels,['Doanh thu năm 2025','Doanh thu trong kỳ','Chi tiêu trong kỳ','Lợi nhuận ròng trong kỳ']);
});
test('full year and arbitrary range have meaningful four-card conventions',async()=>{
 const year=(await ReportService.getReportData('revenue',{startDate:'2025-01-01',endDate:'2025-12-31'})).data;
 assert.deepEqual(year.financial.values,[1500,1500,300,1200]);assert.match(year.financial.period.labels[1],/Doanh thu trong kỳ/);
 const range=(await ReportService.getReportData('revenue',{startDate:'2026-07-31',endDate:'2026-08-01'})).data;
 assert.deepEqual(range.financial.values,[2320,170,25,145]);assert.match(range.financial.period.labels[0],/năm 2026/);
});
test('export includes every filtered row and exactly matches breakdown/totals/search',async()=>{
 const filters={startDate:'2026-08-01',endDate:'2026-08-31',search:'200'};
 const r=(await ReportService.getReportData('revenue',filters)).data;const exported=(await ReportService.exportReportData('revenue',filters)).data;
 assert.deepEqual(exported.rows,r.rows);assert.equal(Number(exported.summary.totalRevenue),200);assert.equal(exported.rows.length,1);
 assert.deepEqual(exported.groups.monthly.map(x=>x.key),['2026-08']);
});
test('CSV export reads all pages in one selected period and reconciles the complete total',async()=>{
 await db.exec("set session_replication_role=replica;insert into payments(customer_id,kiosk_id,price_per_month,total_amount,payment_status,confirmed_at) select 1,1,1,1,'completed','2026-08-10T12:00:00+07:00' from generate_series(1,120);set session_replication_role=origin");
 const r=(await ReportService.exportReportData('revenue',{startDate:'2026-08-01',endDate:'2026-08-31'})).data;
 assert.equal(r.rows.length,123);assert.equal(r.pagination.totalRows,123);assert.equal(Number(r.summary.totalRevenue),470);assert.equal(r.rows.reduce((n,x)=>n+Number(x.totalAmount),0),470);
});
test('bell unread count changes on mark-one/mark-all while sidebar distinct actionable stays unchanged',async()=>{
 first=await rpc('submit_existing_customer_kiosk',[1,kiosk('99999900101')]);second=await rpc('submit_existing_customer_kiosk',[1,kiosk('99999900102')]);
 let n=await AdminNotificationService.getActionable();assert.equal(n.unreadCount,2);assert.equal('registrationCount' in n,false);
 await AdminNotificationService.markRead(n.items[0].id,n.items[0].userId);n=await AdminNotificationService.getActionable();assert.equal(n.unreadCount,1);
 await AdminNotificationService.markAllRead(n.items);n=await AdminNotificationService.getActionable();assert.equal(n.unreadCount,0);assert.equal(n.items.length,2);
});
test('resolved-before-read notification remains unread with neutral historical copy',async()=>{
 const request=await rpc('submit_existing_customer_kiosk',[1,kiosk('99999900104')]);
 await rpc('approve_registration_request',[request.request.id]);const n=await AdminNotificationService.getActionable();
 const old=n.items.find(x=>x.entityId===String(request.request.id));
 assert.ok(old.resolved);assert.equal(old.read,false);assert.match(old.description,/không còn trong trạng thái chờ duyệt/);assert.doesNotMatch(old.description,/đang chờ Ban quản trị/);
});
test('server read state is scoped to account and anonymous clears presentation',async()=>{
 const third=await rpc('submit_existing_customer_kiosk',[1,kiosk('99999900103')]);let n=await AdminNotificationService.getActionable();
 let item=n.items.find(x=>x.entityId===String(third.request.id));assert.equal(item.read,false);
 await AdminNotificationService.markRead(item.id,item.userId);n=await AdminNotificationService.getActionable();item=n.items.find(x=>x.entityId===String(third.request.id));assert.equal(item.read,true);
 await db.query("insert into user_permissions(user_id,permission) values($1,'registration-requests')",[qaUsers.selective]);user='selective';n=await AdminNotificationService.getActionable();
 item=n.items.find(x=>x.entityId===String(third.request.id));assert.equal(item.read,false);
 user=null;n=await AdminNotificationService.getActionable();assert.equal(n.unreadCount,0);assert.deepEqual(n.items,[]);user='admin';
});
test('resolved and read history expires after 90 days while resolved unread remains',async()=>{
 const inserted=await db.query("insert into crm_notifications(notification_type,entity_type,entity_id,occurrence_number,occurrence_key,title,message,target_url,created_at,resolved_at) values('registration_review','registration_request','900001',1,'qa:read-old','old read','old read','#/registration-requests',now()-interval '100 days',now()-interval '91 days'),('registration_review','registration_request','900002',1,'qa:unread-old','old unread','old unread','#/registration-requests',now()-interval '100 days',now()-interval '91 days') returning id,entity_id");
 const readOld=inserted.rows.find(x=>x.entity_id==='900001');await db.query("insert into crm_notification_reads(notification_id,user_id,read_at) values($1,$2,now()-interval '91 days')",[readOld.id,qaUsers.admin]);
 const n=await AdminNotificationService.getActionable();assert.equal(n.items.some(x=>x.entityId==='900001'),false);assert.equal(n.items.find(x=>x.entityId==='900002').read,false);
});
test('PayOS awaiting/retry and terminal requests never enter registration badge; renewal reconciliation is separate',async()=>{
 const before=await AdminNotificationService.getActionable();
 await db.exec("insert into registration_requests(facebook_name,phone,facebook_id,business_type_id,months,status,metadata) values('PAYOS TEST','0900000001','99999900901',1,1,'pending','{\"workflow\":\"public_payos\"}'),('AWAIT TEST','0900000001','99999900902',1,1,'awaiting_payment','{\"workflow\":\"public_payos\"}'),('CANCEL TEST','0900000001','99999900903',1,1,'cancelled','{}'),('DONE TEST','0900000001','99999900904',1,1,'approved','{}')");
 await db.exec("insert into payos_orders(order_code,purpose,payment_id,amount,description,status,reconciliation_required,active_slot) values(99999901,'crm_payment',1,500,'TEST renewal reconciliation','paid',true,null)");
 let n=await AdminNotificationService.getActionable();assert.equal(n.unreadCount,before.unreadCount+1);assert.equal(n.items.filter(x=>x.type==='payment_reconciliation').length,1);
 await db.exec("update payos_orders set reconciliation_required=false where order_code=99999901");n=await AdminNotificationService.getActionable();const reconciliation=n.items.find(x=>x.type==='payment_reconciliation');assert.equal(reconciliation.resolved,true);assert.equal(reconciliation.read,false);
});
test('server feed window is bounded while unread count covers every visible event',async()=>{
 await db.exec("insert into registration_requests(facebook_name,phone,facebook_id,business_type_id,months,status,submitted_at) select 'WINDOW TEST '||n,'0900000001',(99999910000+n)::text,1,1,'pending',now()+n*interval '1 second' from generate_series(1,105) n");
 const n=await AdminNotificationService.getActionable();assert.equal(n.items.length,100);assert.ok(n.unreadCount>100);
 const f=(await asQaUser(db,'admin','select get_crm_notifications() as data')).rows[0].data;assert.equal(f.items.length,100);assert.equal(Number(f.unreadCount),n.unreadCount);
});
test('persistent notification RPC is stable, module-scoped and rejects anonymous reads',async()=>{
 const volatility=(await db.query("select provolatile from pg_proc where proname='get_crm_notifications'")).rows[0].provolatile;assert.equal(volatility,'s');
 await db.query('delete from user_permissions where user_id=$1',[qaUsers.selective]);
 for(const persona of ['zero','selective','disabled','legacy']){const data=(await asQaUser(db,persona,'select get_crm_notifications() data')).rows[0].data;assert.equal(Number(data.unreadCount),0);}
 await assert.rejects(()=>asQaUser(db,null,'select get_crm_notifications()'),e=>e.code==='42501');
});
