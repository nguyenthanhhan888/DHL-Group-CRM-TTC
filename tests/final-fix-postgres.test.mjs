import {test,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {createPermissionQaDatabase,asQaUser,qaUsers} from './fixtures/permission-qa-database.mjs';
let db;
beforeEach(async()=>{db=await createPermissionQaDatabase();await db.exec("select setval('customers_id_seq',100); select setval('kiosks_id_seq',100)");});
afterEach(async()=>db?.close());
const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
const rpc=async(name,args=[],user=null,role=user?'authenticated':'service_role')=>Object.values((await asQaUser(db,user,`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')})`,args,{role})).rows[0])[0];
const kiosk=(id='99999955555',months=1)=>({facebook_name:'TEST Final kiosk',facebook_id:id,facebook_link:`https://www.facebook.com/${id}`,business_type_id:1,months,discount:0});
const submit=(months=1,id='99999955555')=>rpc('submit_public_registration',[{facebook_name:'TEST Final customer',phone:'0900000999'},[kiosk(id,months)],null],null,'anon');
const prepare=async(s)=>rpc('prepare_registration_checkout_v3',[s.kiosks.map(x=>x.request.id),'0900000999',null]);
const order=(p,code,expired=false)=>rpc('record_registration_payos_order',[p.id,code,Number(p.total_amount),'TEST',`https://qa.invalid/${code}`,null,`link-${code}`,{expiresAt:Math.floor(Date.now()/1000)+(expired?-3600:3600)}]);
const paid=o=>rpc('handle_payos_webhook',[o.order_code,Number(o.amount),o.payment_link_id,'bank-'+o.order_code,{data:{reference:'bank-'+o.order_code}},'verified-fixture',null]);
const add=(user='admin',id='99999966666')=>rpc('submit_existing_customer_kiosk',[1,kiosk(id)],user);
const grant=async(keys)=>{await db.query('delete from user_permissions where user_id=$1',[qaUsers.selective]);for(const k of keys)await db.query('insert into user_permissions(user_id,permission) values($1,$2)',[qaUsers.selective,k]);};

test('existing Customer creates multiple pending Kiosks and payments without duplicate Customer/account/PayOS',async()=>{
  const a=await add(),b=await add('admin','99999966667');
  assert.equal(a.customer.id,1);assert.equal(b.kiosk.customer_id,1);
  assert.equal(a.request.status,'pending');assert.equal(a.payment.payment_status,'pending');assert.equal(a.kiosk.status,'pending');assert.equal(a.kiosk.start_date,null);
  assert.equal(Number(await scalar('select count(*) from customers')),1);assert.equal(Number(await scalar('select count(*) from auth.users')),5);
  assert.equal(Number(await scalar('select count(*) from payos_orders')),0);assert.equal(Number(await scalar("select count(*) from payments where payment_status='completed'")),0);
});
test('Add Kiosk denies zero, disabled, legacy-admin, unrelated and stale revoked permissions',async()=>{
  for(const user of ['zero','disabled','legacy','selective'])await assert.rejects(()=>add(user),e=>e.code==='42501');
  await grant(['customers']);await assert.rejects(()=>add('selective'),e=>e.code==='42501');
  await grant(['customer-detail','kiosks']);await add('selective');await grant([]);await assert.rejects(()=>add('selective','99999966667'),e=>e.code==='42501');
  await grant(['customers','kiosk-detail']);await db.query("update user_profiles set web_access_enabled=false where user_id=$1",[qaUsers.selective]);await assert.rejects(()=>add('selective','99999966667'),e=>e.code==='42501');
});
test('duplicate Facebook ID/profile blocked atomically; unchanged Customer and no extra payment',async()=>{
  await add();await assert.rejects(()=>add(),e=>e.code==='23505');
  const altered={...kiosk('99999977777'),facebook_link:kiosk('99999966666').facebook_link.replace('www.','m.')+'?tracking=1'};
  await assert.rejects(()=>rpc('submit_existing_customer_kiosk',[1,altered],'admin'),e=>e.code==='23505');
  assert.equal(Number(await scalar('select count(*) from payments')),1);
});
test('manual pricing validated server-side and zero/invalid package cannot change data',async()=>{
  await assert.rejects(()=>rpc('submit_existing_customer_kiosk',[1,{...kiosk(),months:0}],'admin'));
  await assert.rejects(()=>rpc('submit_existing_customer_kiosk',[1,{...kiosk(),discount:200000}],'admin'));
  const a=await rpc('submit_existing_customer_kiosk',[1,{...kiosk(),total_amount:1,price_per_month:1}],'admin');assert.equal(Number(a.payment.total_amount),100000);
});
test('manual approval preserves pending payment; explicit payment confirmation activates once',async()=>{
  const a=await add();await rpc('approve_registration_request',[a.request.id],'admin');
  assert.equal(await scalar('select payment_status from payments where id=$1',[a.payment.id]),'pending');
  await rpc('confirm_payment',[a.payment.id,'TEST received bank transfer'],'admin');
  assert.equal(await scalar('select status from kiosks where id=$1',[a.kiosk.id]),'active');
  assert.equal(Number(await scalar('select total_paid from customers where id=1')),100000);
});
test('cancel three months -> new one month reuses only unpaid provisional identity, creates new intent',async()=>{
  const s=await submit(3),first=await prepare(s);const old=await order(first.payment,1001);
  await rpc('admin_cancel_awaiting_registration',[s.kiosks[0].request.id,'TEST cancel'],'admin');
  const second=await prepare(await submit(1));
  assert.notEqual(first.payment.id,second.payment.id);assert.equal(first.batch.customer_id,second.batch.customer_id);
  assert.equal(first.items[0].kioskId,second.items[0].kioskId);assert.equal(Number(second.payment.total_amount),100000);
  assert.equal(Number(await scalar('select count(*) from customers')),2);assert.equal(Number(await scalar('select count(*) from kiosks')),2);
  assert.equal(await scalar('select payment_status from payments where id=$1',[first.payment.id]),'cancelled');
  assert.equal((await paid(old)).reconciliation_required,true);
  assert.equal(await scalar('select payment_status from payments where id=$1',[second.payment.id]),'pending');
  assert.equal((await paid(await order(second.payment,1002))).already_processed,false);
  assert.equal(Number(await scalar("select sum(total_amount) from payments where payment_status='completed'")),100000);
  assert.equal(Number(await scalar('select count(*) from registered_kiosks where id=$1',[second.items[0].kioskId])),1);
});
test('same intent retry keeps request/batch/payment and batch intent key stable',async()=>{
  const a=await submit(),b=await submit();assert.deepEqual(a.kiosks.map(x=>x.request.id),b.kiosks.map(x=>x.request.id));
  const x=await prepare(a),y=await prepare(b);assert.equal(x.payment.id,y.payment.id);assert.equal(y.reused,true);
  assert.equal(await scalar('select payment_intent_key from payments where id=$1',[x.payment.id]),'registration-batch:'+x.batch.id);
});
test('already-paid or different-Customer identity cannot be recycled after cancellation',async()=>{
  const a=await prepare(await submit());await paid(await order(a.payment,2001));
  const s=await submit(2);await assert.rejects(()=>prepare(s),e=>e.code==='23505'&&e.constraint==='kiosks_facebook_id_unique');
  assert.equal(Number(await scalar("select sum(total_amount) from payments where payment_status='completed'")),100000);
});
test('expired slot releases on admin access but payment remains pending and QR mapping survives',async()=>{
  const a=await prepare(await submit()),o=await order(a.payment,3001,true);
  await rpc('get_registration_actionable_summary',[],'admin');
  assert.equal(await scalar('select active_slot from payos_orders where id=$1',[o.id]),null);
  assert.equal(await scalar('select status from payos_orders where id=$1',[o.id]),'expired');
  assert.equal(await scalar('select payment_status from payments where id=$1',[a.payment.id]),'pending');
  assert.equal((await paid(o)).already_processed,false);
});
for(const first of ['old','new'])test(`${first} QR wins; second settlement reconciles with no double revenue/activation`,async()=>{
  const a=await prepare(await submit()),old=await order(a.payment,4001,true),fresh=await order(a.payment,4002);
  const winner=first==='old'?old:fresh,loser=first==='old'?fresh:old;
  assert.equal((await paid(winner)).already_processed,false);assert.equal((await paid(winner)).already_processed,true);
  assert.equal((await paid(loser)).reconciliation_required,true);
  assert.equal(Number(await scalar("select sum(total_amount) from payments where payment_status='completed'")),100000);
  assert.equal(Number(await scalar("select count(*) from audit_logs where action='confirm_payos_batch'")),1);
});
test('reserve collision identifies exact slot; provider rejection cleanup releases it and retry succeeds',async()=>{
  const a=await prepare(await submit());const reserve=(code)=>rpc('record_registration_payos_order',[a.payment.id,code,100000,'TEST',null,null,null,{stage:'reserved',expiresAt:Math.floor(Date.now()/1000)+900}]);
  const o=await reserve(5001);await assert.rejects(()=>reserve(5002),e=>e.code==='23505'&&e.constraint==='payos_orders_one_active_payment_uidx');
  assert.equal(await rpc('fail_registration_payos_order',[a.payment.id,5001,'CREATE_PAYOS_ORDER']),true);
  assert.equal(await scalar('select active_slot from payos_orders where id=$1',[o.id]),null);
  assert.equal(await rpc('fail_registration_payos_order',[a.payment.id,5001,'CREATE_PAYOS_ORDER']),false);
  assert.ok((await reserve(5002)).id);
});
test('PayOS cannot use ordinary approval; explicit external confirmation requires payment permission and evidence',async()=>{
  const s=await submit(),a=await prepare(s),id=s.kiosks[0].request.id;
  await assert.rejects(()=>rpc('approve_registration_request',[id],'admin'));
  await grant(['registration-requests']);await assert.rejects(()=>rpc('admin_complete_awaiting_registration',[id,'TEST received'],'selective'),e=>e.code==='42501');
  await assert.rejects(()=>rpc('admin_complete_awaiting_registration',[id,''],'admin'),e=>e.code==='22023');
  await rpc('admin_complete_awaiting_registration',[id,'TEST checked cash receipt'],'admin');
  assert.equal(await scalar('select payment_status from payments where id=$1',[a.payment.id]),'completed');
});
test('badge counts manual review plus distinct nonterminal registration reconciliation, excludes normal unpaid/expired/renewal/closed',async()=>{
  const manual=await add();const unpaid=await prepare(await submit());const expired=await order(unpaid.payment,6001,true);
  let sum=await rpc('get_registration_actionable_summary',[],'admin');assert.equal(sum.actionableRegistrationCount,1);
  await db.query("update payos_orders set reconciliation_required=true where id=$1",[expired.id]);
  sum=await rpc('get_registration_actionable_summary',[],'admin');assert.equal(sum.actionableRegistrationCount,2);
  await rpc('approve_registration_request',[manual.request.id],'admin');sum=await rpc('get_registration_actionable_summary',[],'admin');assert.equal(sum.actionableRegistrationCount,1);
  await rpc('admin_cancel_awaiting_registration',[unpaid.items[0].requestId,'TEST cancel'],'admin');sum=await rpc('get_registration_actionable_summary',[],'admin');assert.equal(sum.actionableRegistrationCount,0);
});
test('Customer duplicate lookup distinguishes normalized exact phone/ID/profile from name warning, excludes self',async()=>{
  await db.exec("update customers set facebook_id='999999123',facebook_link='https://www.facebook.com/999999123' where id=1");
  const find=(p='',f='',l='',n='',id=null)=>rpc('find_customer_duplicates',[p,f,l,n,id],'admin');
  assert.equal((await find('090 000 0001'))[0].match_type,'exact');assert.equal((await find('','999999123'))[0].match_type,'exact');
  assert.equal((await find('','','https://www.facebook.com/999999123?test=1'))[0].match_type,'exact');
  assert.equal((await find('','','','Khách hàng TEST'))[0].match_type,'similar');assert.deepEqual(await find('0900000001','','','',1),[]);
  await assert.rejects(()=>rpc('find_customer_duplicates',['0900000001','','','',null],'zero'),e=>e.code==='42501');
});
