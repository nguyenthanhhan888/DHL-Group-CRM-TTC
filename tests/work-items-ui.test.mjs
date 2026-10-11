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
  for(const id of ['work-item-search','work-item-status','work-item-type','work-item-assignee','work-item-from-date','work-item-to-date','work-item-include-closed']) assert.match(html,new RegExp(`id="${id}"`));
  assert.match(html,/Tạo công việc/);assert.match(html,/Công việc &amp; Ghi chú|Công việc & Ghi chú/);
  const page=source('src/pages/WorkItemsPage.js');
  assert.match(page,/data-work-item-action="complete"/);assert.match(page,/data-work-item-action="cancel"/);
  assert.match(page,/item\?\.start_date \|\| ''/);assert.match(page,/item\?\.due_date \|\| ''/);
  assert.match(page,/creator_name \|\| 'Tài khoản đã xóa'/);
  assert.doesNotMatch(page,/createDateValue/);
});

test('migration keeps creator history nullable without weakening assignee validation',()=>{
  const migration=source('supabase/migrations/20261011074043_create_crm_work_items.sql');
  assert.match(migration,/created_by uuid references auth\.users\(id\) on delete set null/);
  assert.doesNotMatch(migration,/created_by uuid not null|created_by[^\n]+on delete restrict/);
  assert.match(migration,/values\([^\n]+auth\.uid\(\)/);
  assert.match(migration,/assignee_user_id uuid references public\.user_profiles\(user_id\) on delete set null/);
  assert.match(migration,/p_assignee_user_id[^]*status='active' and web_access_enabled/);
});

test('service uses only permission-protected RPC contracts and canonical date values',()=>{
  const service=source('src/services/WorkItemService.js');
  assert.match(service,/rpc\('get_crm_work_items'/);assert.match(service,/rpc\('save_crm_work_item'/);assert.match(service,/rpc\('set_crm_work_item_status'/);
  assert.match(service,/p_start_date: textOrNull\(item\.startDate\)/);assert.match(service,/p_due_date: textOrNull\(item\.dueDate\)/);
  assert.doesNotMatch(service,/service[_-]?role|SUPABASE_SERVICE_ROLE_KEY/i);
});
