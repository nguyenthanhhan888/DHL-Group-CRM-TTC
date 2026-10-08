import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync,readdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import vm from 'node:vm';
import {reportPeriod} from '../src/utils/reportPeriod.js';
import {createDateValue,formatDateTime,vietnamDateRangeYearToDate,toVietnamDateTimeInput,fromVietnamDateTimeInput} from '../src/utils/date.js';
import {dateDisplay,enhanceDateInput} from '../src/components/DateInput.js';
import {promotionDateDefaults} from '../src/utils/promotionForm.js';
import {ALL_PERMISSIONS,canAccessRoute} from '../src/constants/permissions.js';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const now=new Date('2026-10-04T08:00:00Z');
for(const [name,filters,year,yearEnd,labels] of [
 ['default',{},2026,'2026-10-04',['Doanh thu năm 2026','Doanh thu tháng 10','Chi tiêu năm 2026','Lợi nhuận ròng năm 2026']],
 ['current filtered month',{startDate:'2026-06-01',endDate:'2026-06-30'},2026,'2026-10-04'],
 ['historical month',{startDate:'2025-06-01',endDate:'2025-06-30'},2025,'2025-12-31'],
 ['historical full year',{startDate:'2025-01-01',endDate:'2025-12-31'},2025,'2025-12-31'],
 ['cross-year',{startDate:'2025-11-15',endDate:'2026-02-20'},2026,'2026-10-04'],
 ['explicit YTD',{startDate:'2026-01-01',endDate:'2026-10-04'},2026,'2026-10-04'],
]) test(`approved four-card periods: ${name}`,()=>{
 const period=reportPeriod(filters,now);
 assert.deepEqual(period.labels,labels||[`Doanh thu năm ${year}`,'Doanh thu trong kỳ','Chi tiêu trong kỳ','Lợi nhuận ròng trong kỳ']);
 assert.deepEqual(period.yearRange,{startDate:`${year}-01-01`,endDate:yearEnd});
 assert.deepEqual(period.selected,labels?{startDate:'2026-01-01',endDate:'2026-10-04'}:filters);
 assert.equal(period.custom,!labels);
});
test('UI default is explicit, not inferred from matching date values; VN New Year rolls default forward',()=>{
 const p=reportPeriod({startDate:'2025-01-01',endDate:'2025-12-31',customDateRange:false},new Date('2025-12-31T17:00:00Z'));
 assert.equal(p.custom,false);assert.deepEqual(p.selected,{startDate:'2026-01-01',endDate:'2026-01-01'});assert.equal(p.month,1);
});
test('Reports opens and reopens on overview; refresh/date/search preserve selected tab',()=>{
 const source=read('src/pages/ReportsPage.js').replace(/^import .*;\n/gm,'').replace('export function ReportsPage','function ReportsPage');
 const controls=new Map();const tabs=['overview','revenue'].map(reportTab=>({dataset:{reportTab},handlers:{},addEventListener(t,f){this.handlers[t]=f;}}));
 const control=id=>{if(!controls.has(id))controls.set(id,{value:'',handlers:{},addEventListener(t,f){this.handlers[t]=f;}});return controls.get(id);};
 let calls=[];
 const box={vietnamDateRangeYearToDate,PageHeader:()=>'',FilterBar:()=>'',DateRangeFields:()=>'',EmptyState:()=>'',escapeHtml:String,renderIcon:()=>'',setTimeout:f=>{f();return 1;},clearTimeout(){},document:{getElementById:control,querySelectorAll:()=>tabs}};
 vm.createContext(box);vm.runInContext(source,box);
 vm.runInContext('loadReportData = () => capture(state.activeTab); syncControls = () => {}; renderTabs = () => {};',vm.createContext(Object.assign(box,{capture:x=>calls.push(x)})));
 assert.match(box.ReportsPage(),/report-tab active[^>]*data-report-tab="overview"/);
 box.bindEvents();tabs[1].handlers.click();assert.equal(calls.at(-1),'revenue');
 control('report-refresh-button').handlers.click();assert.equal(calls.at(-1),'revenue');
 control('report-start-date').handlers.change({target:{value:'2025-06-01'}});assert.equal(calls.at(-1),'revenue');assert.equal(vm.runInContext('state.filters.customDateRange',box),true);
 control('report-search').handlers.input({target:{value:'Alpha'}});assert.equal(calls.at(-1),'revenue');assert.equal(vm.runInContext('state.filters.search',box),'Alpha');
 assert.match(box.ReportsPage(),/report-tab active[^>]*data-report-tab="overview"/);
});
test('no TTC surfaces or average KPI labels in production UI',()=>{
 for(const path of ['src/app.js','src/constants/navigation.js','shared/permissions.js','src/pages/StaffPage.js','src/pages/UserHomePage.js','src/styles/app.css','api/user-management.js','scripts/dev-server.cjs']) assert.doesNotMatch(read(path),/ttc|TƯƠNG TÁC CHÉO/i,path);
 for(const path of ['src/utils/reportPeriod.js','src/services/ReportService.js','src/pages/ReportsPage.js'])assert.doesNotMatch(read(path),/bình quân|average/i,path);
 for(const path of ['src/pages/TtcPage.js','src/pages/AdminTtcPage.js','src/services/TtcService.js','src/services/TtcAdminService.js','src/services/WalletService.js','api/ttc/verify-facebook-task.js'])assert.equal(existsSync(new URL('../'+path,import.meta.url)),false,path);
 for(const key of ['ttc','admin-ttc','services','tasks','wallet','pricing','violations'])assert.ok(!ALL_PERMISSIONS.includes(key));
 assert.ok(ALL_PERMISSIONS.includes('notifications'));
 for(const route of ['ttc','admin','admin-ttc-users','ttc-wallet'])assert.equal(canAccessRoute({status:'active',web_access_enabled:true,permissions:ALL_PERMISSIONS},route),false);
});
test('create defaults and edit preservation across VN midnight in four device timezones',()=>{
 const script=`import {createDateValue,formatDateTime,toVietnamDateTimeInput,fromVietnamDateTimeInput} from './src/utils/date.js';import {promotionDateDefaults} from './src/utils/promotionForm.js';const now=new Date('2026-10-03T17:00:00Z');console.log(JSON.stringify([createDateValue(null,null,now),createDateValue({id:1},'2025-06-15',now),createDateValue({id:1},null,now),promotionDateDefaults({},now).starts_at,formatDateTime(now),fromVietnamDateTimeInput(toVietnamDateTimeInput(now))]));`;
 const values=['Europe/Berlin','America/Los_Angeles','Pacific/Kiritimati','Asia/Ho_Chi_Minh'].map(TZ=>execFileSync(process.execPath,['--input-type=module','-e',script],{env:{...process.env,TZ},encoding:'utf8'}));
 assert.equal(new Set(values).size,1);assert.deepEqual(JSON.parse(values[0]),['2026-10-04','2025-06-15','','2026-10-04T00:00','04/10/2026 00:00','2026-10-03T17:00:00.000Z']);
 assert.equal(createDateValue(null,null,new Date('2026-10-03T16:59:59Z')),'2026-10-03');
 assert.equal(promotionDateDefaults({id:1,starts_at:null,ends_at:null},now).starts_at,'');
});
test('create form bindings explicitly default start/expense dates; edit date fields remain stored',()=>{
 for(const path of ['src/pages/EmployeesPage.js','src/pages/ExpensesPage.js'])assert.match(read(path),/createDateValue\(item, item\?\./);
 assert.match(read('src/components/KioskEditForm.js'),/state\.kiosk\?\.start_date \|\| ''/);
 assert.match(read('src/components/HistoricalPaymentEditForm.js'),/payment.start_date \|\| ''/);
 assert.match(read('src/utils/promotionForm.js'),/if \(item.id\) return/);
});
test('shared date input displays Vietnam prefill and keeps original ISO timestamp untouched until edited',()=>{
 class Field {
  constructor(){this.dataset={};this.className='form-control';this.classList={contains:()=>false};this.attributes={};this.events={};this.children=[];this.labels=[];}
  get value(){return this._value||'';}set value(v){this._value=v;}
  setAttribute(k,v){this.attributes[k]=v;}getAttribute(k){return this.attributes[k];}closest(){return null;}
  before(wrapper){this.wrapper=wrapper;}append(...nodes){this.children.push(...nodes);}setCustomValidity(v){this.validityMessage=v;}
  checkValidity(){return !this.validityMessage;}reportValidity(){return this.checkValidity();}focus(){}
  addEventListener(k,f){this.events[k]=f;}dispatchEvent(){}
 }
 const saved={document:globalThis.document,HTMLInputElement:globalThis.HTMLInputElement,MutationObserver:globalThis.MutationObserver};
 globalThis.HTMLInputElement=Field;globalThis.document={createElement:()=>new Field()};globalThis.MutationObserver=class{observe(){}};
 try {
  const field=new Field();field.type='date';field.value=createDateValue(null,null,now);enhanceDateInput(field);
  const display=field.wrapper.children[1];assert.equal(display.value,'04/10/2026');assert.equal(field.value,'2026-10-04');
  display.value='20/11/2026';display.events.input();assert.equal(field.value,'2026-11-20');
  const edit=new Field();edit.type='datetime-local';edit.value='2025-06-15T08:30:45.123';enhanceDateInput(edit);
  assert.equal(edit.wrapper.children[1].value,'15/06/2025 08:30');assert.equal(edit.value,'2025-06-15T08:30:45.123');
 } finally {Object.assign(globalThis,saved);}
});
test('shared datetime conversion preserves explicit offsets and optional scheduling stays empty',()=>{
 assert.equal(toVietnamDateTimeInput(null),'');assert.equal(fromVietnamDateTimeInput(''),null);
 assert.equal(fromVietnamDateTimeInput('2025-06-15T08:30:45.123456+07:00'),'2025-06-15T08:30:45.123456+07:00');
 assert.equal(formatDateTime('2026-10-03T17:00:00Z'),'04/10/2026 00:00');
 assert.equal(dateDisplay('2026-10-04T00:00'),'04/10/2026 00:00');
});
