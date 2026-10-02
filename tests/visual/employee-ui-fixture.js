// Real router/layout/pages/services against a local Postgres RPC adapter.
import { AppLayout, bindSidebarPresentation, syncNavigationGroups } from '/src/layouts/AppLayout.js';
import { NAV_SECTIONS } from '/src/constants/navigation.js';
import { Modal } from '/src/components/Modal.js';
import { ExpensesPage } from '/src/pages/ExpensesPage.js';
import { canAccessRoute } from '/src/constants/permissions.js';
import { createRouter } from '/src/router/index.js';
const params = new URLSearchParams(location.search), page = params.get('page') || 'employee-list';
document.documentElement.dataset.theme = params.get('theme') || 'light';
document.documentElement.style.colorScheme = document.documentElement.dataset.theme;
window.qaAccess={permissions:['expenses','logs']}; window.qaCalls=[];
window.DHL_CONFIG={supabaseUrl:location.origin,supabaseAnonKey:'local-qa-only'};
window.supabase={createClient:()=>({rpc:async(name,args)=>{
  qaCalls.push({name,args});
  const response=await fetch('/qa/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,args})});return response.json();
}})};
document.getElementById('app').innerHTML=AppLayout({navSections:NAV_SECTIONS,user:{display_name:'Người kiểm tra CRM',web_access_enabled:true}});
const connectionBadge=document.querySelector('[data-supabase-badge]');
if(connectionBadge)connectionBadge.textContent='Postgres kiểm thử cục bộ';
Modal.mount();bindSidebarPresentation();
const setSidebar=open=>{document.querySelector('[data-sidebar]').classList.toggle('open',open);document.querySelector('[data-sidebar-overlay]').classList.toggle('open',open);};
document.querySelector('[data-menu-toggle]').addEventListener('click',()=>setSidebar(!document.querySelector('[data-sidebar]').classList.contains('open')));
document.querySelector('[data-sidebar-overlay]').addEventListener('click',()=>setSidebar(false));
location.hash=page.startsWith('employee')?'#/expenses?tab=employees':'#/expenses';
createRouter({outlet:document.querySelector('[data-route-outlet]'),routes:{expenses:ExpensesPage,denied:()=>'<p>Không có quyền truy cập.</p>'},defaultRoute:'denied',canAccess:route=>route==='denied'||canAccessRoute(qaAccess,route),onRouteChange:()=>{
  document.querySelectorAll('[data-nav-route]').forEach(link=>link.classList.toggle('active',link.dataset.navRoute==='expenses'));syncNavigationGroups();
}}).start();
const until=async fn=>{for(let n=0;n<100;n++){if(fn())return;await new Promise(r=>setTimeout(r,30));}throw Error('Local UI did not finish loading');};
await until(()=>document.querySelector('[data-employee-action]')||document.querySelector('[data-expense-action]'));
if(page==='employee-create')document.getElementById('employee-add').click();
if(page==='employee-edit')document.querySelector('[data-employee-action="edit"]').click();
if(page==='employee-detail')document.querySelector('[data-employee-action="detail"][data-employee-id="2"]').click();
if(page==='employee-archived'){
  document.getElementById('employee-include-archived').click();await until(()=>document.querySelector('[data-employee-action="restore"]'));
  document.querySelector('[data-employee-action="detail"][data-employee-id="3"]').click();
}
if(page==='expense-create')document.getElementById('expense-add-button').click();
if(page==='expense-edit')document.querySelector('[data-expense-action="edit"][data-expense-id="2"]').click();
if(page==='expense-archived')document.querySelector('[data-expense-action="edit"][data-expense-id="3"]').click();
if(page==='expense-detail')document.querySelector('[data-expense-action="detail"][data-expense-id="3"]').click();
window.qaReady=true;
