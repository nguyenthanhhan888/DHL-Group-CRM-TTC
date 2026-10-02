import {test,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {createPermissionQaBackend} from './fixtures/permission-qa-backend.mjs';
import {asQaUser} from './fixtures/permission-qa-database.mjs';
let qa,providerMode,postCount,providerOrders,delay;
const json=(x,status=200)=>new Response(JSON.stringify(x),{status,headers:{'Content-Type':'application/json'}});
beforeEach(async()=>{
 providerMode='ok';postCount=0;providerOrders=new Map();delay=0;
 qa=await createPermissionQaBackend({providerFetch:async(url,init)=>{
   if(init.method==='GET') {const data=providerOrders.get(Number(url.pathname.split('/').at(-1)));return data?json({code:'00',data}):json({code:'404',desc:'not found'},404);}
   postCount++;const body=JSON.parse(init.body);
   if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
   if(providerMode==='reject')return json({code:'20',desc:'TEST rejected'},400);
   if(providerMode==='timeout')throw Error('TEST network timeout');
   const data={orderCode:body.orderCode,amount:body.amount,id:'link-'+body.orderCode,paymentLinkId:'link-'+body.orderCode,checkoutUrl:'https://pay.qa.invalid/'+body.orderCode,status:'PENDING',amountPaid:0};
   providerOrders.set(body.orderCode,data);return json({code:'00',data});
 }});qa.install();for(const key of ['PAYOS_CLIENT_ID','PAYOS_API_KEY','PAYOS_CHECKSUM_KEY'])process.env[key]='qa-local-only';
 await qa.db.exec("select setval('customers_id_seq',100);select setval('kiosks_id_seq',100)");
});
afterEach(async()=>qa?.close());
const scalar=async(sql,args=[])=>Object.values((await qa.enqueue(()=>qa.db.query(sql,args))).rows[0])[0];
const payload=async(months=1)=>{
 const s=Object.values((await qa.enqueue(()=>asQaUser(qa.db,null,'select submit_public_registration($1,$2,null)',[{facebook_name:'TEST API',phone:'0900000789'},[{facebook_name:'TEST API kiosk',facebook_id:'99999999999',facebook_link:'https://www.facebook.com/99999999999',business_type_id:1,months,discount:0}]]))).rows[0])[0];
 return {requestIds:s.kiosks.map(x=>x.request.id),phone:'0900000789'};
};
const invoke=p=>qa.invoke('/api/payos/create-registration-payment',p);

test('initial checkout + retry reuse one Customer/batch/payment/provider order',async()=>{
 const p=await payload();const a=await invoke(p),b=await invoke(p);assert.equal(a.status,200,JSON.stringify(a.data));assert.equal(b.status,200,JSON.stringify(b.data));assert.equal(a.data.payment.paymentId,b.data.payment.paymentId);assert.equal(postCount,1);
 assert.equal(Number(await scalar('select count(*) from registration_batches')),1);assert.equal(Number(await scalar('select count(*) from payments')),1);
});
test('concurrent HTTP retry creates one provider checkout and preserves one intent',async()=>{
 delay=100;const p=await payload();const results=await Promise.all([invoke(p),invoke(p)]);
 assert.equal(results.filter(r=>r.status===200).length>=1,true);assert.ok(results.every(r=>r.status===200||r.data.code==='CHECKOUT_IN_PROGRESS'),JSON.stringify(results));
 assert.equal(postCount,1);assert.equal(Number(await scalar('select count(*) from payments')),1);assert.equal(Number(await scalar('select count(*) from payos_orders')),1);
 assert.equal((await invoke(p)).status,200);
});
test('definitive provider failure releases reservation and immediate retry creates a new order',async()=>{
 const p=await payload();providerMode='reject';const a=await invoke(p);assert.equal(a.data.code,'PAYOS_CREATE_FAILED');
 assert.equal(await scalar('select status from payos_orders'),'failed');assert.equal(await scalar('select active_slot from payos_orders'),null);
 providerMode='ok';const b=await invoke(p);assert.equal(b.status,200,JSON.stringify(b.data));assert.equal(postCount,2);assert.equal(Number(await scalar('select count(*) from payments')),1);
});
test('ambiguous provider failure retains reservation until deadline; expired retry can regenerate without lost payment',async()=>{
 const p=await payload();providerMode='timeout';await invoke(p);assert.equal(await scalar('select active_slot from payos_orders'),true);
 const held=await invoke(p);assert.equal(held.data.code,'CHECKOUT_IN_PROGRESS');assert.equal(postCount,1);
 await qa.enqueue(()=>qa.db.exec("update payos_orders set expires_at=now()-interval '1 hour',created_at=now()-interval '2 hours'"));
 providerMode='ok';const b=await invoke(p);assert.equal(b.status,200,JSON.stringify(b.data));assert.equal(Number(await scalar('select count(*) from payments')),1);
});
test('cleanup failure is logged, retained safely, then expiry permits retry',async()=>{
 const p=await payload();const transport=globalThis.fetch;globalThis.fetch=(url,init)=>String(url).includes('/fail_registration_payos_order')?Promise.resolve(json({code:'XX000',message:'TEST cleanup unavailable'},500)):transport(url,init);
 providerMode='reject';const a=await invoke(p);assert.equal(a.data.code,'PAYOS_CREATE_FAILED');assert.equal(await scalar('select active_slot from payos_orders'),true);
 globalThis.fetch=transport;await qa.enqueue(()=>qa.db.exec("update payos_orders set expires_at=now()-interval '1 hour',created_at=now()-interval '2 hours'"));
 providerMode='ok';assert.equal((await invoke(p)).status,200);
});
test('cancel package then register new package through actual API creates new 1-month intent',async()=>{
 const p=await payload(3),a=await invoke(p);assert.equal(a.status,200);
 await qa.enqueue(()=>asQaUser(qa.db,'admin','select admin_cancel_awaiting_registration($1,$2)',[p.requestIds[0],'TEST cancel']));
 const b=await invoke(await payload(1));assert.equal(b.status,200,JSON.stringify(b.data));assert.equal(b.data.payment.amount,100000);assert.notEqual(a.data.payment.paymentId,b.data.payment.paymentId);
});
test('23505 identity root cause is reported as identity conflict before provider, never CHECKOUT_IN_PROGRESS',async()=>{
 const p=await payload();await qa.enqueue(()=>qa.db.exec("insert into kiosks(customer_id,facebook_name,facebook_id,business_type_id,status,start_date,end_date) values(1,'Existing','99999999999',1,'active',current_date,current_date+30)"));
 const a=await invoke(p);assert.equal(a.data.code,'FACEBOOK_ID_EXISTS');assert.match(a.data.message,/gia hạn/);assert.equal(postCount,0);
});
test('other unique violations and reserve failures are not misreported as concurrent generation',async()=>{
 const p=await payload(),transport=globalThis.fetch;
 globalThis.fetch=(url,init)=>String(url).includes('/record_registration_payos_order')?Promise.resolve(json({code:'23505',message:'duplicate key violates constraint payments_pkey'},400)):transport(url,init);
 const a=await invoke(p);assert.equal(a.data.code,'REGISTRATION_INTENT_CONFLICT');assert.equal(postCount,0);assert.equal(Number(await scalar('select count(*) from payos_orders')),0);
});

test('public Lookup and Renewal still create and reuse checkout without changing service before settlement',async()=>{
 process.env.PUBLIC_RENEWAL_TOKEN_SECRET='qa-local-renewal-secret-over-thirty-two-characters';
 const lookup=await qa.invoke('/api/public/kiosk-lookup',{phone:'0900000001'});assert.equal(lookup.status,200,JSON.stringify(lookup.data));
 const k=lookup.data.kiosks[0];assert.ok(k.renewalToken);
 const before=await scalar('select end_date from kiosks where id=1');
 const first=await qa.invoke('/api/public/renew-kiosk',{renewalToken:k.renewalToken,months:1,returnUrl:'https://qa.invalid/'});
 assert.equal(first.status,200,JSON.stringify(first.data));
 const again=await qa.invoke('/api/public/renew-kiosk',{renewalToken:k.renewalToken,months:1,returnUrl:'https://qa.invalid/'});assert.equal(again.status,200,JSON.stringify(again.data));assert.equal(again.data.orderCode,first.data.orderCode);
 assert.deepEqual(await scalar('select end_date from kiosks where id=1'),before);assert.equal(postCount,1);
});
