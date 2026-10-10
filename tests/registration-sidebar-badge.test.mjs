import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {registrationFollowup,countActionableRegistrations,isBusinessRegistration,isLegacyRequest} from '../src/utils/registrationFollowup.js';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const app=read('src/app.js'), page=read('src/pages/RegistrationRequestsPage.js');
const actionable=[
 {id:1,status:'pending'},
 {id:2,status:'pending',metadata:{source:'legacy'}},
 {id:3,status:'awaiting_payment',customer_id:1,kiosk_id:1,payment_id:1,payment_status:'pending'},
 {id:4,status:'awaiting_payment',customer_id:1,kiosk_id:1,payment_id:1,payment_status:'pending',payos_state:'expired'},
 {id:5,status:'approved',metadata:{request_type:'additional'},customer_id:1,kiosk_id:null},
 {id:6,status:'pending',metadata:{request_type:'additional'}},
];
const automated=[
 {id:7,status:'pending',metadata:{workflow:'public_payos'}},
 {id:8,status:'pending',registration_batch_id:8},
 {id:9,status:'pending',metadata:{workflow:'public_payos'},registration_batch_id:8},
];
const terminal=['completed','cancelled','rejected','approved'].map((status,i)=>({id:10+i,status,customer_id:1,kiosk_id:1,metadata:{source:'legacy'}}));
function badgeHarness(getCount){
 const badge={textContent:'',isConnected:true,hidden:true,classList:{toggle(_,value){badge.hidden=value;},add(){badge.hidden=true;}}};
 const box=vm.createContext({document:{querySelector:()=>badge},RegistrationRequestService:{getActionableCount:getCount},localStorage:new Proxy({}, {get(){throw Error('Badge must not read localStorage');}})});
 vm.runInContext(app.slice(app.indexOf('let registrationBadgeRefreshId'),app.indexOf('let notificationRefreshId')),box);
 return {badge,refresh:()=>box.refreshRegistrationBadge()};
}
function actionRenderer(source,canConfirmPayment=true){
 const box=vm.createContext({state:{canConfirmPayment},registrationFollowup,isLegacyRequest,escapeHtml:String});
 const start=source.indexOf('function actionButtons('),end=source.indexOf('\n}',start)+2;
 vm.runInContext(source.slice(start,end),box);return box.actionButtons;
}
test('four human-work records render badge 4, excluding unpaid and technical pending',async()=>{
 const h=badgeHarness(async()=>countActionableRegistrations([...actionable,...automated]));await h.refresh();
 assert.equal(h.badge.textContent,'4');assert.equal(h.badge.hidden,false);
});
test('one actionable row with two buttons counts once, even if repeated in fetched data',()=>{
 assert.equal((actionRenderer(page)(actionable[0]).match(/<button/g)||[]).length,2);
 assert.equal(countActionableRegistrations([actionable[0],{...actionable[0],id:'1'}]),1);
});
test('terminal rows count zero and hide the badge',async()=>{
 const h=badgeHarness(async()=>countActionableRegistrations(terminal));await h.refresh();
 assert.equal(h.badge.textContent,'0');assert.equal(h.badge.hidden,true);
});
test('mixed states count distinct non-terminal records and approved incomplete review',()=>{
 assert.equal(countActionableRegistrations([...actionable,...terminal,...automated,...actionable]),4);
 assert.equal(registrationFollowup(actionable[4]).actions,'needs-review');
 assert.equal(registrationFollowup({id:99,status:'approved',metadata:{source:'legacy'},customer_id:null,kiosk_id:1}).actionable,true);
 assert.equal(registrationFollowup({id:100,status:'rejected',metadata:{source:'legacy'},customer_id:null}).actionable,false);
});
test('notification unread/read history never feeds or overwrites the sidebar badge',async()=>{
 const badgeCode=app.slice(app.indexOf('let registrationBadgeRefreshId'),app.indexOf('let notificationRefreshId'));
 assert.doesNotMatch(badgeCode,/AdminNotificationService|unread|localStorage|registrationCount/);
 const bellCode=app.slice(app.indexOf('let notificationRefreshId'),app.indexOf('function applySavedTheme'));
 assert.doesNotMatch(bellCode,/data-registration-nav-count|refreshRegistrationBadge/);
 const h=badgeHarness(async()=>7);
 for(const unreadCount of [0,1,100]){globalThis.unreadCount=unreadCount;await h.refresh();assert.equal(h.badge.textContent,'7');}
 delete globalThis.unreadCount;
});
test('refresh after transition to terminal updates badge; action and list-refresh events are wired',async()=>{
 let rows=[{id:1,status:'pending'}];const h=badgeHarness(async()=>countActionableRegistrations(rows));
 await h.refresh();assert.equal(h.badge.textContent,'1');
 rows=[{id:1,status:'cancelled'}];await h.refresh();assert.equal(h.badge.textContent,'0');assert.ok(h.badge.hidden);
 assert.match(app,/addEventListener\('dhl:actionable-registration-changed', refreshRegistrationBadge\)/);
 assert.match(app,/addEventListener\('dhl:registration-list-refreshed', refreshRegistrationBadge\)/);
 assert.match(page,/RegistrationRequestService.list\(\);\s*window.dispatchEvent\(new CustomEvent\('dhl:registration-list-refreshed'\)\)/);
});
test('page buttons follow the approved vocabulary for all established states',()=>{
 const withPayment=actionRenderer(page,true),withoutPayment=actionRenderer(page,false);
 for(const row of [actionable[0],actionable[1],actionable[5]]){
  assert.match(withPayment(row),/>Duyệt<.*>Từ chối</s);assert.doesNotMatch(withPayment(row),/Duyệt hồ sơ|Duyệt & lưu/);
 }
 assert.match(withPayment(actionable[2]),/>Tạo\/Mở PayOS<.*>Xác nhận đã nhận tiền<.*>Hủy hồ sơ</s);
 assert.match(withoutPayment(actionable[2]),/Chờ khách thanh toán.*>Hủy hồ sơ</s);
 assert.match(withPayment(actionable[4]),/Cần kiểm tra/);assert.match(withPayment(actionable[4]),/>Kiểm tra<|Thiếu liên kết Kiosk/);assert.doesNotMatch(withPayment(actionable[4]),/Hoàn tất lưu/);
 for(const row of [...terminal,...automated,{id:93,status:'unknown'}]) assert.equal(withPayment(row),'—');
});
test('badge service uses the business-visible Admin list and counts each ID once',async()=>{
 const rows=[...actionable,...automated,...terminal];const calls=[];
 const client={rpc(name,args){calls.push({name,args});return Promise.resolve({data:rows});}};
 const box=vm.createContext({requireSupabaseClient:()=>client,runQuery:async q=>q,countActionableRegistrations,isBusinessRegistration});
 vm.runInContext(read('src/services/RegistrationRequestService.js').replace(/^import .*;\n/gm,'').replace('export const RegistrationRequestService','globalThis.service'),box);
 const visible=await box.service.list();assert.equal(visible.data.some(row=>automated.includes(row)),false);
 assert.equal(await box.service.getActionableCount(),4);assert.deepEqual(JSON.parse(JSON.stringify(calls)),[
  {name:'admin_list_registration_requests',args:{status_input:null}},{name:'admin_list_registration_requests',args:{status_input:null}},
 ]);
});
test('a slower old refresh cannot restore the count after a newer terminal refresh',async()=>{
 const pending=[];const h=badgeHarness(()=>new Promise(resolve=>pending.push(resolve)));
 const old=h.refresh(),fresh=h.refresh();pending[1](0);await fresh;pending[0](7);await old;
 assert.equal(h.badge.textContent,'0');assert.ok(h.badge.hidden);
});
test('read failure hides stale count; unsupported states are not guessed',async()=>{
 const h=badgeHarness(async()=>{throw Error('read failed');});h.badge.textContent='7';h.badge.hidden=false;
 await h.refresh();assert.equal(h.badge.textContent,'');assert.ok(h.badge.hidden);
 assert.equal(countActionableRegistrations([{id:1,status:'unknown'},{id:2,status:'approved',payment_status:'pending',customer_id:1,kiosk_id:1,payment_id:1}]),0);
});

test('each human-work state counts its registration ID exactly once',()=>{
 for(const row of actionable.filter(row=>registrationFollowup(row).actionable)){
  assert.equal(registrationFollowup(row).actionable,true);
  assert.equal(countActionableRegistrations([row,{...row,id:String(row.id)}]),1);
 }
 for(const row of automated){
  assert.deepEqual(registrationFollowup(row),{actionable:false,actions:'none',bucket:'hidden'});
  assert.equal(countActionableRegistrations([row]),0);
 }
});
test('100 successful unpaid PayOS registrations never affect the badge',()=>{
 const rows=Array.from({length:100},(_,index)=>({id:1000+index,status:'awaiting_payment',metadata:{workflow:'public_payos'},registration_batch_id:index+1,
  customer_id:1,kiosk_id:1,payment_id:index+1,payment_status:'pending',payos_checkout_created:true}));
 assert.equal(countActionableRegistrations(rows),0);
 for(const row of rows)assert.equal(registrationFollowup(row).bucket,'awaiting-payment');
});
test('all missing-data reasons still contribute only one registration to the badge',()=>{
 const row={id:30,status:'approved',metadata:{source:'legacy'},total_amount:100};
 assert.deepEqual(registrationFollowup(row).reasons,[
  'Thiếu liên kết Khách hàng','Thiếu liên kết Kiosk','Thiếu giao dịch thanh toán',
 ]);
 assert.equal(countActionableRegistrations([row,{...row,id:'30'}]),1);
});
