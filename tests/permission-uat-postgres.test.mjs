import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createPermissionQaDatabase, asQaUser, qaUsers } from './fixtures/permission-qa-database.mjs';
import { ALL_PERMISSIONS } from '../src/constants/permissions.js';
let db;
const scalar = async(sql,values=[]) => Object.values((await db.query(sql,values)).rows[0])[0];
const call = async(user,sql,values=[]) => (await asQaUser(db,user,sql,values)).rows;
const grant = async(permission,user='selective') => db.query('insert into public.user_permissions(user_id,permission) values($1,$2) on conflict do nothing',[qaUsers[user],permission]);
const revoke = async(user='selective') => db.query('delete from public.user_permissions where user_id=$1',[qaUsers[user]]);
const denied = fn => assert.rejects(fn,error=>error.code==='42501');
before(async()=>{db=await createPermissionQaDatabase(); await db.exec("select setval('customers_id_seq',10); select setval('kiosks_id_seq',10); select setval('categories_id_seq',10); select setval('business_types_id_seq',10)");});
after(async()=>db?.close());
beforeEach(async()=>{
  await db.exec("delete from public.user_permissions; update public.app_permissions set is_active=true");
  await db.query("update public.user_profiles set status='active',web_access_enabled=true where user_id in($1,$2,$3)",[qaUsers.zero,qaUsers.selective,qaUsers.legacy]);
});

for(const permission of ALL_PERMISSIONS) test(`${permission}: canonical deny → grant → revoke uses current DB state with unchanged JWT`,async()=>{
  const check=async()=>Object.values((await call('selective','select public.has_user_permission($1)',[permission]))[0])[0];
  assert.equal(await check(),false); await grant(permission); assert.equal(await check(),true);
  const profile=(await call('selective','select public.get_my_access_profile() profile'))[0].profile;
  assert.deepEqual(profile.permissions,[permission]);
  await revoke(); assert.equal(await check(),false);
  assert.equal((await call('selective','select public.get_my_access_profile() profile'))[0].profile.status,'active');
});

const reads=[
  ['dashboard','select public.get_dashboard_data()'],
  ['reports','select public.get_reports_data()'],
  ['customers','select public.get_customer_status_data()'],
  ['customer-detail','select public.get_customer_status_data(p_customer_id=>1)'],
  ['kiosks','select public.get_kiosk_status_data()'],
  ['kiosk-detail','select public.get_kiosk_status_data()'],
  ['registration-requests','select public.admin_list_registration_requests(null)'],
  ['payments','select public.get_payment_summary(null,null,null,null,null,null)'],
  ['expenses','select public.get_employees_data()'],
  ['expenses','select public.get_employee_expenses_data()'],
  ['logs',"select public.get_business_events('logs')"],
  ['settings','select public.get_organization_settings()'],
  ['homepage-content','select public.get_homepage_admin_data()'],
];
for(const [permission,sql] of reads)test(`actual RPC ${sql}: grant works alone; revoke/disabled/legacy denied; admin allowed`,async()=>{
  await denied(()=>call('zero',sql)); await denied(()=>call('selective',sql));
  await grant(permission); assert.ok((await call('selective',sql)).length);
  await revoke(); await denied(()=>call('selective',sql));
  await grant(permission); await db.query("update public.user_profiles set status='locked',web_access_enabled=false where user_id=$1",[qaUsers.selective]);
  await denied(()=>call('selective',sql)); await denied(()=>call('legacy',sql));
  assert.ok((await call('admin',sql)).length);
});

test('self escalation, self reactivation and direct permission grants are blocked, own contact edit allowed',async()=>{
  for(const patch of ["is_system_admin=true","web_access_enabled=true","status='active'","user_id='00000000-0000-4000-8000-000000001001'"])
    await denied(()=>call('zero',`update public.user_profiles set ${patch} where user_id=auth.uid()`));
  await denied(()=>call('disabled',"update public.user_profiles set status='active',web_access_enabled=true where user_id=auth.uid()"));
  await denied(()=>call('zero',"insert into public.user_permissions(user_id,permission) values(auth.uid(),'user-management')"));
  assert.equal((await call('zero',"update public.user_profiles set display_name='TEST contact' where user_id=auth.uid() returning user_id")).length,1);
  assert.equal((await call('zero',"update public.user_profiles set display_name='attacker' where user_id=$1 returning user_id",[qaUsers.admin])).length,0);
});

test('inactive permission catalog, web-disabled user and legacy admin cannot bypass canonical permissions',async()=>{
  await grant('customers'); await db.exec("update public.app_permissions set is_active=false where permission='customers'");
  await denied(()=>call('selective','select public.get_customer_status_data()'));
  await db.exec("update public.app_permissions set is_active=true where permission='customers'");
  await db.query('update public.user_profiles set web_access_enabled=false where user_id=$1',[qaUsers.selective]);
  await denied(()=>call('selective','select public.get_customer_status_data()'));
  assert.equal((await call('legacy','select count(*)::int count from public.customers'))[0].count,0);
  assert.equal((await call('legacy','select public.is_active_promotion_admin() allowed'))[0].allowed,false);
});

for(const [table,permission,insert,update] of [
  ['customers','customers',"insert into public.customers(facebook_name) values('TEST CRUD') returning id","facebook_name='TEST updated'"],
  ['kiosks','kiosks',"insert into public.kiosks(customer_id,facebook_name,business_type_id,category_id,status) values(1,'TEST CRUD',1,1,'active') returning id","facebook_name='TEST updated'"],
  ['categories','categories',"insert into public.categories(name) values('TEST CRUD') returning id","name='TEST updated'"],
  ['business_types','business-types',"insert into public.business_types(category_id,name,price_per_month) values(1,'TEST CRUD',100000) returning id","name='TEST updated'"],
])test(`${table}: actual RLS SELECT/INSERT/UPDATE/DELETE and revoke retain business rows`,async()=>{
  await denied(()=>call('zero',insert)); await grant(permission);
  const id=(await call('selective',insert))[0].id;
  assert.equal((await call('selective',`update public.${table} set ${update} where id=$1 returning id`,[id])).length,1);
  await revoke();
  assert.equal((await call('selective',`update public.${table} set ${update} where id=$1 returning id`,[id])).length,0);
  assert.equal((await call('selective',`delete from public.${table} where id=$1 returning id`,[id])).length,0);
  assert.equal(await scalar(`select count(*)::int from public.${table} where id=$1`,[id]),1);
  await grant(permission); assert.equal((await call('selective',`delete from public.${table} where id=$1 returning id`,[id])).length,1);
});

test('Employees and Expenses lifecycle use expenses only, revoke preserves attribution/history and does not create users',async()=>{
  const before=await scalar('select count(*)::int from auth.users');
  const save="select public.save_employee(null,'TEST Employee',null,'TEST','2026-09-01','active',null) item";
  await denied(()=>call('zero',save)); await grant('expenses');
  const employee=(await call('selective',save))[0].item;
  const expense=(await call('selective',"select public.save_employee_expense(null,'bonus',100000,'2026-09-20',$1,null,'cash','TEST') item",[employee.id]))[0].item;
  await call('selective',"select public.save_employee($1,'TEST edited',null,'TEST','2026-09-01','active',null)",[employee.id]);
  for(const action of ['left','reactivate','archive','restore']) await call('selective','select public.set_employee_lifecycle($1,$2)',[employee.id,action]);
  const category=(await call('selective',"select public.save_expense_category(null,'TEST category') item"))[0].item;
  await call('selective','select public.archive_expense_category($1)',[category.id]);
  await revoke();
  await denied(()=>call('selective','select public.set_employee_lifecycle($1,\'archive\')',[employee.id]));
  await denied(()=>call('selective','select public.archive_expense($1,\'TEST\')',[expense.expense.id]));
  assert.equal((await call('selective','select * from public.employees where id=$1',[employee.id])).length,0);
  assert.equal(await scalar('select count(*)::int from public.employees where id=$1',[employee.id]),1);
  assert.equal(await scalar('select count(*)::int from auth.users'),before);
  await grant('expenses'); await call('selective','select public.archive_expense($1,\'TEST\')',[expense.expense.id]);
});

test('Promotions remains canonical admin-only: create/edit/pause/delete; all permissions do not make a user admin',async()=>{
  for(const p of ALL_PERMISSIONS)await grant(p);
  const payload={code:'AUTHQA',name:'TEST promotion',discount_type:'percentage',discount_value:10,scope_type:'all'};
  const save='select public.admin_save_promotion($1,$2,\'{}\',\'{}\') item';
  for(const user of ['zero','selective','disabled','legacy'])await denied(()=>call(user,save,[null,payload]));
  const row=(await call('admin',save,[null,payload]))[0].item;
  await call('admin',save,[row.id,{...payload,name:'TEST edited'}]);
  assert.equal((await call('selective','update public.promotions set is_active=false where id=$1 returning id',[row.id])).length,0);
  await call('admin','update public.promotions set is_active=false where id=$1',[row.id]);
  await denied(()=>call('zero','select public.admin_delete_unused_promotion($1)',[row.id]));
  await call('admin','select public.admin_delete_unused_promotion($1)',[row.id]);
});

test('anon cannot read raw CRM; public catalog/homepage/registration remain usable',async()=>{
  for(const table of ['customers','kiosks','payments','employees','expenses','promotions','user_profiles'])await denied(()=>call(null,`select * from public.${table}`));
  assert.ok((await call(null,'select * from public.categories')).length);
  assert.ok((await call(null,'select * from public.business_types')).length);
  assert.ok((await call(null,'select public.get_public_homepage_content()')).length);
  assert.ok((await call(null,"select public.submit_public_registration($1,$2,null)",[{facebook_name:'TEST public',phone:'0900000099'},[{facebook_name:'TEST public kiosk',facebook_id:'999990099',facebook_link:'https://www.facebook.com/999990099',business_type_id:1,months:1,discount:0}]])).length);
});

test('private helpers and service-only checkout/webhook RPC are not callable by browser roles',async()=>{
  for(const user of ['zero','selective','admin']) {
    await denied(()=>call(user,'select private.ensure_wallet($1)',[qaUsers.zero]));
    await denied(()=>call(user,"select public.prepare_registration_checkout_v3('{}','0900000001',null)"));
  }
  const unsafe=(await db.query("select n.nspname,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and has_function_privilege('authenticated',p.oid,'EXECUTE') and p.proname<>'current_user_role'")).rows;
  assert.deepEqual(unsafe,[]);
});

test('Settings and Website publishing each require their own explicit permission and stop after revoke',async()=>{
  const settings="select public.update_organization_settings($1,'QA permission test')";
  await denied(()=>call('zero',settings,[{official_group_name:'TEST organization',warning_days:30}]));
  await grant('settings');await call('selective',settings,[{official_group_name:'TEST organization',warning_days:30}]);
  await denied(()=>call('selective',"select public.save_homepage_content('{}')"));
  await revoke();await denied(()=>call('selective',settings,[{official_group_name:'REVOKED'}]));
  await grant('homepage-content');
  const content=(await call('selective','select public.get_public_homepage_content() data'))[0].data.content;
  await call('selective','select public.save_homepage_content($1)',[{...content,heroTitle:'TEST published'}]);
  assert.equal((await call(null,'select public.get_public_homepage_content() data'))[0].data.content.heroTitle,'TEST published');
  const business=(await call('selective',"select public.save_featured_business($1) data",[{name:'TEST business',category:'TEST',enabled:true,displayOrder:1}]))[0].data;
  await revoke();await denied(()=>call('selective','select public.archive_featured_business($1)',[business.id]));
  await denied(()=>call('selective','select public.save_homepage_content($1)',[content]));
  await grant('homepage-content');await call('selective','select public.archive_featured_business($1)',[business.id]);
});

test('Payments grant allows renewal pending/edit/note/confirm/adjust; revoke blocks; manual renewal and historical correction remain admin-only',async()=>{
  const create='select public.create_renewal_payment(1,1,0,null,\'TEST renewal\',null) data';
  await denied(()=>call('zero',create));await grant('payment-detail');await denied(()=>call('selective',create));await grant('payments');
  const pending=(await call('selective',create))[0].data.payment;
  await call('selective','select public.update_pending_payment($1,1,0,\'cash\',null,\'TEST edit\',\'QA edit\')',[pending.id]);
  await call('selective',"select public.update_payment_note($1,'TEST note','QA note')",[pending.id]);
  const manual="select public.admin_manual_renew_kiosk(1,1,current_date,100000,0,null,'cash','TEST manual') data";
  await denied(()=>call('selective',manual));
  const correction="select public.correct_historical_payment($1,current_date,(current_date+30),1,100000,'TEST correction')";
  await denied(()=>call('selective',correction,[pending.id]));
  await revoke();
  for(const sql of ['select public.confirm_payment($1,\'QA confirm\')','select public.cancel_payment($1,\'QA cancel\')','select public.reject_payment($1,\'QA reject\')',"select public.update_payment_note($1,'REVOKED','QA')"])
    await denied(()=>call('selective',sql,[pending.id]));
  assert.equal(await scalar('select payment_status from public.payments where id=$1',[pending.id]),'pending');
  await grant('payments');await call('selective',"select public.confirm_payment($1,'QA confirm')",[pending.id]);
  assert.equal(await scalar('select payment_status from public.payments where id=$1',[pending.id]),'completed');
  await call('selective',"select public.create_payment_adjustment($1,-1000,0,'QA adjustment')",[pending.id]);
  await revoke();await denied(()=>call('selective',"select public.create_payment_adjustment($1,-1000,0,'REVOKED')",[pending.id]));
  await call('admin',manual);
  await call('admin',correction,[pending.id]);
});

test('canonical Registration approval restores original pending-payment behavior; reject/cancel require grant and revoked actions preserve rows',async()=>{
  const manual=(await call('admin','select public.submit_existing_customer_kiosk($1,$2) data',[1,{facebook_name:'TEST approval kiosk',facebook_id:'8888888888',facebook_link:'https://www.facebook.com/8888888888',business_type_id:1,months:1,discount:0}]))[0].data;
  const request=manual.request.id;
  const approve='select public.approve_registration_request($1) data';
  await denied(()=>call('zero',approve,[request]));await grant('registration-requests');
  const result=(await call('selective',approve,[request]))[0].data;
  assert.equal(result.request.id,request);assert.equal(result.request.status,'approved');assert.equal(result.payment.payment_status,'pending');
  assert.equal(await scalar('select status from public.registration_requests where id=$1',[request]),'approved');
  await assert.rejects(()=>call('selective',approve,[request]),/Pending/);
  const rejectId=await scalar("insert into public.registration_requests(facebook_name,phone,business_type_id,months,status) values('TEST rejection','0900000087',1,1,'pending') returning id");
  await revoke();await denied(()=>call('selective',"select public.reject_registration_request($1,'TEST reason')",[rejectId]));
  assert.equal(await scalar('select status from public.registration_requests where id=$1',[rejectId]),'pending');
  await grant('registration-requests');await call('selective',"select public.reject_registration_request($1,'TEST reason')",[rejectId]);
  assert.equal(await scalar('select status from public.registration_requests where id=$1',[rejectId]),'rejected');
  const publicRequest=(await call(null,'select public.submit_public_registration($1,$2,null) data',[{facebook_name:'TEST cancel',phone:'0900000086'},[{facebook_name:'TEST cancel kiosk',facebook_id:'999990086',facebook_link:'https://www.facebook.com/999990086',business_type_id:1,months:1,discount:0}]]))[0].data.kiosks[0].request.id;
  await call('selective',"select public.admin_cancel_awaiting_registration($1,'TEST cancel')",[publicRequest]);
  assert.equal(await scalar('select status from public.registration_requests where id=$1',[publicRequest]),'cancelled');
});

test('TTC user RPCs require ttc, not merely authenticated; legacy admin cannot bypass revoke',async()=>{
  await db.query("insert into public.user_facebook_accounts(user_id,facebook_id,facebook_url_original,facebook_url_normalized,facebook_id_status,is_primary) values($1,'7777777001','https://www.facebook.com/7777777001','https://www.facebook.com/7777777001','manual_verified',true)",[qaUsers.selective]);
  for(const sql of ['select public.list_available_ttc_tasks()','select public.list_my_ttc_tasks()','select public.list_available_ttc_campaigns()']){
    await denied(()=>call('zero',sql));await denied(()=>call('legacy',sql));
    await grant('ttc');assert.ok((await call('selective',sql)).length);await revoke();await denied(()=>call('selective',sql));
  }
});

test('wallet order reservation blocks disabled account and unrelated TTC admin CRM access; personal wallet remains active-user area',async()=>{
  const wallet="select public.record_payos_payment_link('wallet_topup',null,auth.uid(),$1,10000,'TEST wallet')";
  await call('zero',wallet,[990001]);
  await denied(()=>call('disabled',wallet,[990002]));
  await qaDisabledWeb();
  await denied(()=>call('selective',wallet,[990003]));
  await denied(()=>call('selective','select public.get_my_wallet()'));
  await db.query('update public.user_profiles set web_access_enabled=true where user_id=$1',[qaUsers.selective]);
  await grant('admin-ttc');
  await denied(()=>call('selective',"select public.record_payos_payment_link('crm_payment',null,null,990004,10000,'TEST CRM')"));
  async function qaDisabledWeb(){await db.query('update public.user_profiles set web_access_enabled=false where user_id=$1',[qaUsers.selective]);}
});
