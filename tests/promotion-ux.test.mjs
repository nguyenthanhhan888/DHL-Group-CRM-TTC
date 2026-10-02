import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { promotionDraft, promotionDateDefaults, promotionPayload, promotionInstant, promotionLocalDate, promotionErrors, switchPromotionTimeMode, promotionReward, promotionApplicability, promotionPeriod } from '../src/utils/promotionForm.js';
import { PromotionService } from '../src/services/PromotionService.js';
const now = new Date('2026-12-31T20:45:51.321Z');
const valid = { code: 'QA', name: 'Ưu đãi', discount_type: 'percentage', discount_value: '20', scope_type: 'all', start_mode: 'scheduled', time_mode: 'timed', ...promotionDateDefaults({},now) };
const calls=[];
globalThis.window={DHL_CONFIG:{supabaseUrl:'https://qa.invalid',supabaseAnonKey:'qa'},supabase:{createClient:()=>({rpc:async(name,args)=>{calls.push({name,args});return {data:{},error:null};}})}};
test('new timed defaults use Vietnam business time and seven days across year boundaries',()=>{
  assert.deepEqual(promotionDateDefaults({},now),{starts_at:'2027-01-01T03:45',ends_at:'2027-01-08T03:45'});
  assert.equal(promotionDraft({},now).time_mode,'timed'); assert.deepEqual(promotionErrors(valid),{});
});
test('timed/unlimited switching clears only the end and leaves the original untouched',()=>{
  const item={id:1,starts_at:'2026-12-31T20:45:12.123456Z',ends_at:'2027-01-15T00:00:00Z',is_active:false};
  const original=structuredClone(item), draft=promotionDraft(item);
  const unlimited=switchPromotionTimeMode(draft,'unlimited',now);
  assert.equal(unlimited.ends_at,'');assert.equal(unlimited.starts_at,draft.starts_at);
  assert.equal(promotionPayload(unlimited,item).ends_at,null);
  const timed=switchPromotionTimeMode(unlimited,'timed',now);
  assert.ok(Date.parse(promotionInstant(timed.ends_at))>Date.parse(promotionInstant(timed.starts_at)));
  assert.deepEqual(item,original);
});
test('no-change edit retains exact original timestamp precision, nulls, reward and inactive status',async()=>{
  for(const starts_at of [null,'2026-09-01T03:12:45.123456+00:00'])for(const ends_at of [null,'2026-12-01T03:12:45.654321+00:00'])for(const discount_type of ['percentage','fixed_amount','bonus_months']){
    const item={...valid,id:1,discount_type,discount_value:2,starts_at,ends_at,is_active:false,minimum_order_amount:0};
    const draft=promotionDraft(item);assert.equal(draft.time_mode,ends_at?'timed':'unlimited');
    const payload=promotionPayload(draft,item);
    await PromotionService.save(payload,[],[],item.id);
    const sent=calls.at(-1).args.promotion_input;
    assert.equal(sent.starts_at,starts_at);assert.equal(sent.ends_at,ends_at);assert.equal(sent.is_active,false);assert.equal(sent.minimum_order_amount,0);assert.equal(sent.discount_type,discount_type);
  }
});
test('unlimited creation preserves a scheduled start; immediate mode removes the lower boundary',()=>{
  const draft=switchPromotionTimeMode(promotionDraft({},now),'unlimited',now);
  assert.equal(promotionPayload(draft).ends_at,null);assert.equal(promotionPayload(draft).starts_at,'2027-01-01T03:45');
  assert.equal(promotionPayload({...draft,start_mode:'immediate'}).starts_at,null);
  const timed=switchPromotionTimeMode({...draft,start_mode:'immediate',starts_at:''},'timed',now);
  assert.equal(timed.ends_at,'2027-01-08T03:45');assert.equal(promotionPayload(timed).starts_at,null);
  const oldStart=switchPromotionTimeMode({...draft,starts_at:'2020-01-01T00:00'},'timed',now);
  assert.equal(oldStart.ends_at,'2027-01-08T03:45');
});
test('validation aligns percentages, whole rewards, optional zero order amount, dates and scopes',()=>{
  for(const patch of [{name:'  '},{code:''},{discount_value:101},{discount_value:0},{discount_value:1.5},{minimum_kiosk_count:0},{minimum_months:-1},{minimum_order_amount:-1},{ends_at:'2026-01-01T00:00'},{ends_at:'2026-02-31T09:00'},{starts_at:'bad'}])assert.ok(Object.keys(promotionErrors({...valid,...patch})).length,JSON.stringify(patch));
  assert.deepEqual(promotionErrors({...valid,minimum_order_amount:0,ends_at:valid.starts_at}),{});
  assert.ok(promotionErrors({...valid,scope_type:'category'}).scope_type);
  assert.deepEqual(promotionErrors({...valid,scope_type:'business_type'},[],[2]),{});
  assert.deepEqual(promotionErrors({...valid,time_mode:'unlimited',ends_at:'bad'}),{});
});
test('changed local time converts with +07:00 and reload/edit has no shift in foreign browser zones',()=>{
  const moduleUrl=new URL('../src/utils/promotionForm.js',import.meta.url).href;
  const script=`import {promotionInstant,promotionLocalDate} from ${JSON.stringify(moduleUrl)}; const v='2026-09-22T23:15:42.456';console.log(JSON.stringify([promotionInstant(v),promotionLocalDate(promotionInstant(v))]));`;
  const expected=['2026-09-22T16:15:42.456Z','2026-09-22T23:15:42.456'];
  for(const TZ of ['America/Los_Angeles','Europe/Berlin','Asia/Ho_Chi_Minh']){
    const result=spawnSync(process.execPath,['--input-type=module','-e',script],{env:{...process.env,TZ},encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),expected);
  }
});
test('summary describes actual reward, scopes, minimums and independent time boundaries',()=>{
  assert.match(promotionReward({discount_type:'percentage',discount_value:20,max_discount_amount:100000}),/20%.*100.000/);
  assert.match(promotionReward({discount_type:'bonus_months',discount_value:2}),/mỗi Kiosk đủ điều kiện/);
  assert.match(promotionApplicability({scope_type:'category',minimum_months:12,minimum_kiosk_count:2},['Ăn uống']),/Đăng ký mới và gia hạn.*Ăn uống.*12 tháng.*2 Kiosk/);
  assert.match(promotionPeriod({starts_at:null,ends_at:null}),/Không giới hạn thời gian.*Bắt đầu ngay/);
  assert.match(promotionPeriod({starts_at:'2026-09-22T00:00:00Z',ends_at:null}),/Không giới hạn thời gian.*7:00/);
  assert.doesNotMatch(promotionPeriod({starts_at:null,ends_at:'2026-09-22T00:00:00Z'}),/Không giới hạn thời gian/);
});
