import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NAV_SECTIONS } from '../src/constants/navigation.js';
import { canAccessRoute, PERMISSIONS } from '../src/constants/permissions.js';
import { WorkItemsPage } from '../src/pages/WorkItemsPage.js';

const source = path => readFileSync(new URL(`../${path}`,import.meta.url),'utf8');

test('module navigation appears only with work-items permission and is never public',()=>{
  const denied={status:'active',web_access_enabled:true,is_system_admin:false,permissions:[]};
  const granted={...denied,permissions:[PERMISSIONS.WORK_ITEMS]};
  const item=NAV_SECTIONS.flatMap(section=>section.items).find(entry=>entry.route==='work-items');
  assert.ok(item);assert.equal(canAccessRoute(denied,item.route),false);assert.equal(canAccessRoute(granted,item.route),true);
  const app=source('src/app.js');
  assert.match(app,/'work-items': WorkItemsPage/);
  assert.doesNotMatch(app.match(/const PUBLIC_ROUTES[^;]+/)?.[0]||'',/work-items/);
});

test('page exposes practical filters, one action menu and complete/cancel workflows',()=>{
  const html=WorkItemsPage();
  for(const id of ['work-item-search','work-item-status','work-item-type','work-item-assignee','work-item-from-date','work-item-to-date']) assert.match(html,new RegExp(`id="${id}"`));
  assert.doesNotMatch(html,/work-item-include-closed/);
  assert.match(html,/Tạo Job/);assert.match(html,/<h1>Job<\/h1>/);
  assert.doesNotMatch(html,/<details|<summary|work-item-time-filter/);
  assert.match(html,/filter-field filter-field-date/);
  assert.match(html,/class="form-control compact-date" type="date"/);
  assert.doesNotMatch(html,/id="work-item-(?:from|to)-date"[^>]*value=/);
  assert.match(html,/<th>Job<\/th><th>Khách hàng \/ Kiosk<\/th><th>Nhân viên<\/th><th>Thời gian<\/th><th>Trạng thái<\/th><th>Thao tác<\/th>/);
  const page=source('src/pages/WorkItemsPage.js');
  assert.match(page,/data-work-item-action="complete"/);assert.match(page,/data-work-item-action="cancel"/);
  assert.match(page,/createDateValue\(null, null\)/);
  assert.match(page,/name="startDate" type="date"/);assert.match(page,/name="dueDate" type="date"/);
  assert.match(page,/startDate\.value > form\.elements\.dueDate\.value/);
  assert.match(page,/dueDate\.setCustomValidity/);
  assert.match(page,/name="assigneeEmployeeId"/);
  assert.doesNotMatch(page,/name="assigneeUserId"/);
  assert.match(page,/item \? .*item\.status.* : 'pending'/);
  assert.match(page,/creator_name \|\| 'Tài khoản đã xóa'/);
});

test('Job form is compact, follows the requested field order and keeps its footer outside the scroll area',()=>{
  const page=source('src/pages/WorkItemsPage.js');
  const form=page.slice(page.indexOf('<form id="work-item-form"'),page.indexOf('const form = document.getElementById'));
  const fields=['name="title"','name="workType"','name="scope"','name="customerId"','name="kioskId"','name="assigneeEmployeeId"','name="startDate"','name="dueDate"','name="note"'];
  const positions=fields.map(field=>form.indexOf(field));
  assert.ok(positions.every(position=>position>=0));
  assert.deepEqual([...positions].sort((a,b)=>a-b),positions);
  assert.doesNotMatch(form,/work-item-form-section-title|<h3>|data-date-help/);
  assert.match(form,/work-item-form-content[^]*work-item-form-grid[^]*<\/div>\s*<\/div>\s*<div class="modal-actions work-item-form-actions"/);
  const css=source('src/styles/app.css');
  assert.match(css,/\.work-item-form-content \{[^}]*overflow-y:auto/);
  assert.match(css,/\.work-item-form-actions \{[^}]*position:static/);
  assert.match(css,/\.work-item-modal \.modal-body \{[^}]*overflow:hidden/);
  assert.match(css,/\.work-item-filter-bar \.filter-field-date,\.payments-filter-bar \.filter-field-date \{[^}]*flex:0 1 152px/);
  assert.match(css,/@media\(max-width:640px\) \{[^]*\.work-item-filter-bar \.filter-field-date[^}]*flex-basis:100%/);
});

test('Job dates start empty, pass exact optional bounds and reset without time limits',()=>{
  const page=source('src/pages/WorkItemsPage.js');
  assert.match(page,/filters: \{ search: '', status: 'open', workType: '', assigneeEmployeeId: '', fromDate: '', toDate: '' \}/);
  assert.match(page,/\['work-item-from-date','fromDate'\], \['work-item-to-date','toDate'\]/);
  assert.match(page,/state\.filters\[key\] = event\.target\.value;\s*load\(\)/);
  assert.match(page,/WorkItemService\.list\(state\.filters\)/);
  assert.match(page,/Object\.assign\(state\.filters,\{search:'',status:'open',workType:'',assigneeEmployeeId:'',fromDate:'',toDate:''\}\)/);
  assert.match(page,/\['work-item-from-date',''\],\['work-item-to-date',''\]/);
  assert.doesNotMatch(page,/WORK_ITEM_DEFAULT_DATE_RANGE|currentWorkItemYear|fromDate: state\.filters\.fromDate ===/);
});

test('migration adds a separate Employee FK and preserves legacy User assignment contracts',()=>{
  const original=source('supabase/migrations/20261011074043_create_crm_work_items.sql');
  const migration=source('supabase/migrations/20261017103004_job_employee_assignment.sql');
  assert.match(original,/created_by uuid references auth\.users\(id\) on delete set null/);
  assert.match(original,/assignee_user_id uuid references public\.user_profiles\(user_id\) on delete set null/);
  assert.match(migration,/add column if not exists assignee_employee_id bigint/);
  assert.match(migration,/references public\.employees\(id\)[^]*on delete restrict/);
  assert.match(migration,/p_assignee_employee_id bigint/);
  assert.match(migration,/employee\.employment_status='active' and employee\.archived_at is null/);
  assert.match(migration,/assignee_user_id=case when p_assignee_employee_id is not null then null else previous\.assignee_user_id end/);
  assert.doesNotMatch(migration,/update public\.crm_work_items[^;]+assignee_employee_id[^;]+from public\.employees/);
});

test('service uses only permission-protected RPC contracts and canonical date values',()=>{
  const service=source('src/services/WorkItemService.js');
  assert.match(service,/rpc\('get_crm_work_items'/);assert.match(service,/rpc\('save_crm_work_item'/);assert.match(service,/rpc\('set_crm_work_item_status'/);
  assert.match(service,/p_assignee_employee_id: positiveIntegerOrNull/);
  assert.doesNotMatch(service,/p_assignee_user_id/);
  assert.match(service,/p_start_date: textOrNull\(item\.startDate\)/);assert.match(service,/p_due_date: textOrNull\(item\.dueDate\)/);
  assert.doesNotMatch(service,/service[_-]?role|SUPABASE_SERVICE_ROLE_KEY/i);
});

test('navigation uses Job label without changing route or permission identifiers',()=>{
  const navigation=source('src/constants/navigation.js');
  assert.match(navigation,/'work-items': 'Job'/);
  assert.match(navigation,/{ route: 'work-items', label: 'Job'/);
  assert.match(source('shared/permissions.js'),/WORK_ITEMS:[ ]*'work-items'/);
});
