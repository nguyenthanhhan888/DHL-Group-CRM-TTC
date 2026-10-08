import {test,afterEach} from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {execFileSync} from 'node:child_process';
import {formatDate,formatDateTime} from '../src/utils/date.js';
import {dateDisplay,dateIso} from '../src/components/DateInput.js';import {reportPeriod} from '../src/utils/reportPeriod.js';
import {FacebookIdService} from '../src/services/FacebookIdService.js';
const require=createRequire(import.meta.url),handler=require('../api/facebook-id.js');
const originalFetch=globalThis.fetch;afterEach(()=>{globalThis.fetch=originalFetch;});
async function call(url='https://facebook.com/NTH204.vn/') {const res={setHeader(){},status(v){this.statusCode=v;return this;},json(v){this.payload=v;return this;}};await handler({method:'POST',body:{facebook_url:url}},res);return res;}
test('date field supports display, keyboard digits, null/empty, leap date and ISO roundtrip',()=>{
 assert.equal(dateDisplay('2026-10-03'),'03/10/2026');assert.equal(dateIso('03/10/2026'),'2026-10-03');assert.equal(dateIso('03102026'),'2026-10-03');
 for(const v of [null,undefined,'']) assert.equal(dateDisplay(v),'');
 assert.equal(dateIso('29/02/2024'),'2024-02-29');assert.equal(dateIso('29/02/2025'),'');assert.equal(dateIso('31/04/2026'),'');
 assert.equal(dateDisplay('2026-10-03T09:45:30.123'),'03/10/2026 09:45');
 assert.equal(dateIso('03/10/2026 09:45:30.123',{withTime:true}),'2026-10-03T09:45:30.123');
 assert.equal(dateIso('03/10/2026 25:00',{withTime:true}),'');
});
test('calendar display/payload/default period is identical in Germany/US/Vietnam at VN day boundary',()=>{
 const code="import {dateDisplay,dateIso} from './src/components/DateInput.js';import {vietnamDateRangeYearToDate} from './src/utils/date.js';console.log(JSON.stringify([dateDisplay('2026-08-01'),dateIso('01/08/2026'),vietnamDateRangeYearToDate(new Date('2026-07-31T17:00:00Z'))]));";
 const values=['Europe/Berlin','America/Los_Angeles','Asia/Ho_Chi_Minh'].map(TZ=>execFileSync(process.execPath,['--input-type=module','-e',code],{env:{...process.env,TZ},encoding:'utf8'}));
 assert.equal(new Set(values).size,1);assert.deepEqual(JSON.parse(values[0]),['01/08/2026','2026-08-01',{from:'2026-01-01',to:'2026-08-01'}]);
});
test('shared date/time rendering uses four-digit VN calendar years',()=>{
 assert.equal(formatDate('2026-08-01'),'01/08/2026');assert.match(formatDateTime('2026-07-31T17:00:00Z'),/01\/08\/2026/);assert.equal(formatDateTime(null),'—');
});
test('period context handles default/current month/historical month/year/day/cross-year without runtime label leakage',()=>{
 const now=new Date('2026-10-03T08:00:00Z');assert.equal(reportPeriod({},now).mode,'ytd');
 assert.equal(reportPeriod({startDate:'2026-06-01',endDate:'2026-06-30'},now).mode,'range');
 assert.equal(reportPeriod({startDate:'2025-06-01',endDate:'2025-06-30'},now).year,2025);
 assert.equal(reportPeriod({startDate:'2025-01-01',endDate:'2025-12-31'},now).mode,'range');
 assert.equal(reportPeriod({startDate:'2026-08-01',endDate:'2026-08-01'},now).selected.endDate,'2026-08-01');
 assert.equal(reportPeriod({startDate:'2025-08-15',endDate:'2026-03-20'},now).mode,'range');
 assert.throws(()=>reportPeriod({startDate:'2026-02-30',endDate:'2026-03-01'},now));
});
test('Facebook provider success stays supported and receives only validated URL',async()=>{
 globalThis.fetch=async(_,options)=>{assert.equal(new URLSearchParams(options.body).get('link'),'https://facebook.com/NTH204.vn/');return {ok:true,json:async()=>({id:'100001234567890',name:'TEST'})};};
 const r=await call();assert.equal(r.statusCode,200);assert.equal(r.payload.facebook_id,'100001234567890');
});
test('HTTP-200 provider CAPTCHA code 403 is BLOCKED, friendly and never NOT_FOUND',async()=>{
 globalThis.fetch=async()=>({ok:true,json:async()=>({error:'Xác minh reCAPTCHA thất bại — raw-private-provider-detail',code:403})});
 const r=await call();assert.equal(r.statusCode,503);assert.equal(r.payload.code,'FACEBOOK_ID_PROVIDER_BLOCKED');assert.match(r.payload.message,/nhập Facebook ID thủ công/);assert.doesNotMatch(r.payload.message,/raw-private/);
});
test('provider HTTP failure, invalid JSON and real not-found remain different diagnostics',async()=>{
 globalThis.fetch=async()=>({ok:false,status:500});assert.equal((await call()).payload.code,'UPSTREAM_HTTP_ERROR');
 globalThis.fetch=async()=>({ok:true,json:async()=>{throw Error('JSON');}});assert.equal((await call()).payload.code,'UPSTREAM_INVALID_JSON');
 globalThis.fetch=async()=>({ok:true,json:async()=>({error:'not found'})});assert.equal((await call()).payload.code,'FACEBOOK_ID_NOT_FOUND');
});
test('timeout remains timeout without retry',async()=>{
 globalThis.fetch=async()=>{const e=Error('timeout');e.name='AbortError';throw e;};const r=await call();assert.equal(r.statusCode,504);assert.equal(r.payload.code,'UPSTREAM_TIMEOUT');
});
test('numeric profile URLs parse locally; post/video/group IDs are never mistaken for profile identity',async()=>{
 globalThis.fetch=async()=>{throw Error('provider must not be called');};
 for(const url of ['https://www.facebook.com/profile.php?id=100001234567890&ref=share','https://m.facebook.com/100001234567890/']) assert.equal((await call(url)).payload.facebook_id,'100001234567890');
 for(const path of ['watch/?v=1234567','groups/1234567','photo.php?fbid=1234567','1234567/posts/890']) assert.equal(handler._test.facebookIdFromProfileUrl('https://facebook.com/'+path),'');
});
test('direct numeric ID does not become a fabricated readonly Facebook name',async()=>{
 globalThis.fetch=async()=>({ok:true,json:async()=>({success:true,facebook_id:'100001234567890',facebook_url:'https://facebook.com/100001234567890'})});
 const result=await FacebookIdService.resolve('https://facebook.com/100001234567890');
 assert.equal(result.facebookId,'100001234567890');assert.equal(result.facebookName,'');
});
