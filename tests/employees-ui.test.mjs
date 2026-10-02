import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EmployeeService } from '../src/services/EmployeeService.js';
import { ExpenseService } from '../src/services/ExpenseService.js';
import { EmployeesPage } from '../src/pages/EmployeesPage.js';
import { ExpensesPage } from '../src/pages/ExpensesPage.js';
import { canAccessRoute } from '../src/constants/permissions.js';
import { createRouter } from '../src/router/index.js';
import { expenseEmployeeOptions, expenseAttribution } from '../src/utils/employeePresentation.js';
import { businessEventPresentation } from '../src/utils/businessEventPresentation.js';

const calls=[];
globalThis.window={DHL_CONFIG:{supabaseUrl:'https://local.invalid',supabaseAnonKey:'fixture'},supabase:{createClient:()=>({rpc:async(name,params)=>{calls.push({name,params});return {data:{},error:null};}})}};
test('Employee/Expense services call explicit employee RPC contracts with no auth account creation',async()=>{
  await EmployeeService.save({fullName:'  Nguyễn A  '});
  assert.deepEqual(calls.at(-1),{name:'save_employee',params:{p_id:null,p_full_name:'Nguyễn A',p_phone:null,p_job_title:null,p_start_date:null,p_employment_status:'active',p_notes:null}});
  await EmployeeService.lifecycle(4,'archive');assert.equal(calls.at(-1).params.p_action,'archive');
  await ExpenseService.save({category:'other',amount:450000,expenseDate:'2026-09-17',employeeId:'4',paymentMethod:'cash'},2);
  assert.equal(calls.at(-1).name,'save_employee_expense');assert.equal(calls.at(-1).params.p_employee_id,'4');assert.ok(!('p_employee_user_id' in calls.at(-1).params));
  await ExpenseService.save({category:'other',amount:1,expenseDate:'2026-09-17',paymentMethod:'cash'});
  assert.equal(calls.at(-1).params.p_employee_id,null);
  await ExpenseService.list({employeeId:'4'});assert.equal(calls.at(-1).name,'get_employee_expenses_data');assert.equal(calls.at(-1).params.p_employee_id,'4');
  await ExpenseService.checkSalaryDuplicate(4,'2026-09',2);assert.equal(calls.at(-1).params.p_salary_period,'2026-09-01');
});
test('active-only options preserve selected inactive history; filters include archived Employees; HTML escaped',()=>{
  const rows=[{id:1,full_name:'A <QA>',employment_status:'active'},{id:2,full_name:'Đã nghỉ',employment_status:'left'},{id:3,full_name:'Lưu trữ',employment_status:'active',archived_at:'2026-09-01'}];
  const fresh=expenseEmployeeOptions(rows);assert.match(fresh,/Không gắn nhân viên/);assert.match(fresh,/A &lt;QA&gt;/);assert.doesNotMatch(fresh,/value="[23]"/);
  const old=expenseEmployeeOptions(rows,3);assert.match(old,/value="3" selected/);assert.match(old,/Đã lưu trữ/);
  assert.match(expenseEmployeeOptions(rows,null,{filter:true}),/value="2"/);
  assert.match(expenseEmployeeOptions([],9,{current:{employee_name:'Tên lịch sử',employment_status:'left'}}),/value="9" selected/);
});
test('historical snapshot is authoritative after rename/archive and honest when linkage is absent',()=>{
  const info=expenseAttribution({employee_id:2,employee_name_snapshot:'Tên cũ',employee_current_name:'Tên mới',employment_status:'left',employee_archived_at:'2026-09-21',attribution_state:'linked'});
  assert.equal(info.name,'Tên cũ');assert.match(info.note,/Đã lưu trữ.*Tên hiện tại: Tên mới/);
  assert.match(expenseAttribution({employee_name:'Tên lịch sử',attribution_state:'legacy'}).note,/Chưa liên kết/);
  assert.equal(expenseAttribution({}).name,'Không gắn nhân viên');
});
test('Employee secondary tab uses existing expenses route and direct navigation respects grant/revoke',()=>{
  const allowed={status:'active',web_access_enabled:true,permissions:['expenses']},denied={status:'active',web_access_enabled:true,permissions:[]};
  assert.equal(canAccessRoute(allowed,'expenses'),true);assert.equal(canAccessRoute(denied,'expenses'),false);
  const page=ExpensesPage({params:new URLSearchParams('tab=employees')});assert.match(page,/employee-add/);assert.doesNotMatch(page,/expense-add-button/);
  const expensePage=ExpensesPage();assert.match(expensePage,/#\/expenses\?tab=employees/);
  let callback,rendered=0,active=allowed;
  const prior={...window};
  window.location={hash:'#/expenses?tab=employees'};window.addEventListener=(_,fn)=>{callback=fn;};
  const outlet={innerHTML:''};const render=({params})=>{rendered++;assert.equal(params.get('tab'),'employees');return EmployeesPage();};
  createRouter({outlet,routes:{expenses:render},defaultRoute:'home',canAccess:route=>canAccessRoute(active,route)}).start();assert.equal(rendered,1);
  active=denied;callback();assert.equal(rendered,1);assert.equal(window.location.hash,'#/home');
  Object.assign(window,prior);
  const nav=readFileSync(new URL('../src/constants/navigation.js',import.meta.url),'utf8');assert.doesNotMatch(nav,/route: 'employees'/);
});
test('Employee event copy stays business-readable without changing existing Expense presentation',()=>{
  assert.equal(businessEventPresentation({event_type:'employee',title:'Nguyễn A đã nghỉ việc',actor_name:'Admin'}).title,'Nguyễn A đã nghỉ việc');
  const old=businessEventPresentation({event_type:'expense'},{action:'create_salary_expense',actor_name:'Admin',after:{amount:5000000,employee_name:'Nguyễn A',salary_period:'2026-09-01'}});
  assert.match(old.title,/ghi nhận lương/);assert.match(old.secondary,/Nhân viên: Nguyễn A.*09\/2026/);
});
