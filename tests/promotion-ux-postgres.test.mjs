import { before, after, beforeEach, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createPromotionQaDatabase } from './fixtures/promotion-qa-database.mjs';
import { promotionDraft, promotionPayload, switchPromotionTimeMode } from '../src/utils/promotionForm.js';
import { PromotionService } from '../src/services/PromotionService.js';
let db;
const scalar=async(sql,values=[])=>Object.values((await db.query(sql,values)).rows[0])[0];
const rpc=(name,values=[])=>scalar(`select public.${name}(${values.map((_,i)=>`$${i+1}`).join(',')})`,values);
const item=async id=>scalar('select to_jsonb(p) from public.promotions p where id=$1',[id]);
const qaWindow={DHL_CONFIG:{supabaseUrl:'https://qa.invalid',supabaseAnonKey:'qa'},supabase:{createClient:()=>({rpc:async(name,args)=>{
  try { return {data:await rpc(name,[args.promotion_id_input,args.promotion_input,args.category_ids_input,args.business_type_ids_input]),error:null}; }
  catch(error){return {data:null,error};}
}})}};
before(async()=>{db=await createPromotionQaDatabase();globalThis.window=qaWindow;});
after(async()=>db?.close());
beforeEach(async()=>{await db.exec('savepoint test_case');});
afterEach(async()=>{await db.exec('rollback to savepoint test_case; release savepoint test_case; reset role; set role authenticated');});

test('actual save RPC preserves all business fields and scopes for untouched timed/unlimited/inactive records',async()=>{
  for(const id of [1,2,3,4]){
    const original=await item(id);
    const categories=(await db.query('select category_id from public.promotion_categories where promotion_id=$1 order by category_id',[id])).rows.map(r=>r.category_id);
    const types=(await db.query('select business_type_id from public.promotion_business_types where promotion_id=$1 order by business_type_id',[id])).rows.map(r=>r.business_type_id);
    await PromotionService.save(promotionPayload(promotionDraft(original),original),categories,types,id);
    const saved=await item(id);delete saved.updated_at;delete original.updated_at;assert.deepEqual(saved,original);
    assert.deepEqual((await db.query('select category_id from public.promotion_categories where promotion_id=$1 order by category_id',[id])).rows.map(r=>r.category_id),categories);
    assert.deepEqual((await db.query('select business_type_id from public.promotion_business_types where promotion_id=$1 order by business_type_id',[id])).rows.map(r=>r.business_type_id),types);
  }
});
test('Create, reload, Edit round trip and mode switches use existing nullable timestamp representation',async()=>{
  let draft={...promotionDraft({},new Date('2026-09-23T08:25:00Z')),code:'NEWQA',name:'Kiểm thử',discount_value:20};
  const created=(await PromotionService.save(promotionPayload(draft))).data;
  assert.equal(created.starts_at,'2026-09-23T08:25:00+00:00');assert.equal(created.ends_at,'2026-09-30T08:25:00+00:00');
  draft=switchPromotionTimeMode(promotionDraft(created),'unlimited');
  await PromotionService.save(promotionPayload(draft,created),[],[],created.id);
  const unlimited=await item(created.id);assert.equal(unlimited.ends_at,null);assert.equal(unlimited.starts_at,created.starts_at);
  const timed=switchPromotionTimeMode(promotionDraft(unlimited),'timed',new Date('2026-09-23T08:25:00Z'));
  await PromotionService.save(promotionPayload(timed,unlimited),[],[],created.id);
  assert.equal((await item(created.id)).ends_at,created.ends_at);
});
test('registration and renewal evaluation are identical before/after no-change Edit for every reward and status',async()=>{
  await db.exec('reset role');
  const customer=await scalar("insert into public.customers(facebook_name,phone,status) values('QA','0900000901','active') returning id");
  const kiosk=await scalar("insert into public.kiosks(customer_id,facebook_name,business_type_id,category_id,start_date,end_date,status) values($1,'QA',1,1,'2020-01-01',current_date+10,'active') returning id",[customer]);
  const evaluate=async code=>({registration:await rpc('preview_registration_promotion',[code,'0900000901',[{months:6,totalAmount:600000,businessTypeId:1,categoryId:1}]]),renewal:await rpc('preview_renewal_promotion',[kiosk,6,code])});
  for(const id of [1,2,3,4]){
    const original=await item(id),beforeResult=await evaluate(original.code);
    const categories=id===3?Array.from({length:24},(_,i)=>i+1):[],types=id===4?[1,24]:[];
    await PromotionService.save(promotionPayload(promotionDraft(original),original),categories,types,id);
    assert.deepEqual(await evaluate(original.code),beforeResult);
    for(const key of ['valid','discountAmount','finalAmount','totalBonusMonths'])assert.equal(beforeResult.registration[key],beforeResult.renewal[key]);
  }
});
test('new UI payload retains authoritative registration PayOS payable and bonus-month behavior',async()=>{
  await db.exec('reset role');
  const original=await item(1);
  await PromotionService.save(promotionPayload(promotionDraft(original),original),[],[],1);
  const submission=await rpc('submit_public_registration',[{facebook_name:'QA checkout',phone:'0900000902'},[{facebook_name:'QA checkout kiosk',facebook_id:'99990000902',facebook_link:'https://www.facebook.com/99990000902',business_type_id:1,months:6,discount:0}],null]);
  const batch=await rpc('prepare_registration_checkout_v3',[submission.kiosks.map(k=>k.request.id),'0900000902','TIMED20']);
  assert.equal(Number(batch.payment.total_amount),480000);assert.equal(Number(batch.payment.discount),120000);
  const order=await rpc('record_registration_payos_order',[batch.payment.id,990001,480000,'QA','https://pay.payos.vn/local-qa',null,'local-qa-link',{expiresAt:Math.floor(Date.now()/1000)+3600}]);
  assert.equal(Number(order.amount),480000);
  const bonus=await rpc('preview_registration_promotion',['BONUS2','0900000902',[{months:6,totalAmount:600000,businessTypeId:1,categoryId:1}]]);
  assert.equal(bonus.finalAmount,600000);assert.equal(bonus.items[0].effectiveMonths,8);
});
