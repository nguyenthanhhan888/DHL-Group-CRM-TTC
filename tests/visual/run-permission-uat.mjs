// Actual application + SDK + API handlers + SQL authorization. Only Auth/HTTP transport is local.
import {createPermissionQaBackend,QA_PASSWORD} from '../fixtures/permission-qa-backend.mjs';
import {qaUsers} from '../fixtures/permission-qa-database.mjs';
import {startChrome} from './permission-chrome-driver.mjs';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=resolve(fileURLToPath(new URL('../..',import.meta.url))),out=process.env.DHL_QA_OUTPUT ? resolve(process.env.DHL_QA_OUTPUT) : join(root,'docs/qa/user-permissions-v1/chrome');
await mkdir(out,{recursive:true});
const qa=await createPermissionQaBackend(),results=[],apiErrors=[];
const actionsOnly=process.argv.includes('--actions-only');
let phase='initial';
const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost'),path=decodeURIComponent(url.pathname);
  try{
    if(path==='/config.js'||path==='/config.local.js'){res.writeHead(200,{'Content-Type':'text/javascript'}).end(`window.DHL_CONFIG={supabaseUrl:${JSON.stringify(origin)},supabaseAnonKey:'qa-anon'};`);return;}
    if(path.startsWith('/api/')||path.startsWith('/auth/v1/')||path.startsWith('/rest/v1/')){
      let raw='';for await(const chunk of req)raw+=chunk;
      if(path.startsWith('/api/')){
        const result=await qa.invoke(path,raw?JSON.parse(raw):{},String(req.headers.authorization||'').replace(/^Bearer /i,''),Object.fromEntries(url.searchParams));
        res.writeHead(result.status,{'Content-Type':'application/json',...result.headers}).end(JSON.stringify(result.data));return;
      }
      const response=await qa.fetch(origin+req.url,{method:req.method,headers:req.headers,body:raw||undefined}),body=await response.text();
      if(!response.ok)apiErrors.push({path,status:response.status,body,phase});
      res.writeHead(response.status,Object.fromEntries(response.headers)).end(body);return;
    }
    if(path!=='/'&&path!=='/index.html'&&!/^\/(src|shared|images)\//.test(path)){res.writeHead(404).end();return;}
    if(path.includes('..')){res.writeHead(403).end();return;}
    const bytes=await readFile(join(root,path==='/'?'index.html':path));
    res.writeHead(200,{'Content-Type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'}[extname(path).toLowerCase()]||'text/html','Cache-Control':'no-store'}).end(bytes);
  }catch(error){apiErrors.push({path,message:error.message});res.writeHead(500,{'Content-Type':'application/json'}).end(JSON.stringify({message:error.message}));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;qa.install(origin);
let chrome;
try{
  chrome=await startChrome();const {cdp,evaluate,until,click,pause}=chrome;
  const fill=async(values)=>evaluate(`(()=>{for(const [selector,value] of Object.entries(${JSON.stringify(values)})){const n=document.querySelector(selector);if(!n)throw Error('Missing '+selector);n.value=value;n.dispatchEvent(new Event('input',{bubbles:true}));n.dispatchEvent(new Event('change',{bubbles:true}));}})()`);
  let navigation=0;
  const go=async route=>{const url=`${origin}/index.html?qaNavigation=${++navigation}#/${route}`;await cdp('Page.navigate',{url});await until(`location.search==='?qaNavigation=${navigation}'&&document.readyState==='complete'`);await pause(150);};
  const login=async(persona)=>{
    await go('login');await evaluate('localStorage.clear()');await go('login');await until("!!document.getElementById('login-form')");
    await fill({'#login-username':persona.startsWith('qa_')?persona:`qa_${persona}`,'#login-password':QA_PASSWORD});await click('#login-submit');
    await until("!!document.querySelector('[data-route-outlet]')");await pause(150);
  };
  const sync=async permissions=>{
    const result=await qa.invoke('/api/user-management',{action:'sync_permissions',userId:qaUsers.selective,permissions,adminPassword:QA_PASSWORD},qa.sessionFor('admin').access_token);
    assert.equal(result.status,200,JSON.stringify(result));
  };
  const shot=async(label,width,height)=>{
    await evaluate('document.fonts.ready');await pause(100);
    const metrics=await evaluate(`(()=>{const rect=n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};const overlay=document.querySelector('[data-modal-overlay]'),modal=overlay&&!overlay.classList.contains('hidden')?document.querySelector('[data-modal]'):null;const save=document.querySelector('[data-permission-save]');return {width:innerWidth,scrollWidth:document.documentElement.scrollWidth,route:location.hash,modal:modal?rect(modal):null,save:save?rect(save):null,nav:[...document.querySelectorAll('[data-sidebar] a[href]')].map(n=>n.getAttribute('href'))};})()`);
    assert.ok(metrics.scrollWidth<=width,`${label} viewport overflow ${metrics.scrollWidth}`);
    if(metrics.modal)assert.ok(metrics.modal.x>=0&&metrics.modal.y>=0&&metrics.modal.right<=width+1&&metrics.modal.bottom<=height+1,`${label} modal outside viewport`);
    if(metrics.save)assert.ok(metrics.save.y>=0&&metrics.save.bottom<=height,`${label} Save hidden`);
    const image=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(join(out,label+'.png'),Buffer.from(image.data,'base64'));
    results.push({label,pass:true,...metrics});console.log(`${label}: PASS`);
  };
  for(const theme of actionsOnly?[]:['light','dark'])for(const width of theme==='light'?[1440,1280,768,390]:[1280,390]){
    const height=width===390?844:1000,suffix=`${width}-${theme}`;
    phase=suffix;
    await cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width===390});
    await cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme}]});
    await login('zero');await evaluate(`localStorage.setItem('dhlThemePreference',${JSON.stringify(theme)})`);await go('user');
    await until("!!document.querySelector('[data-sidebar]')");
    assert.equal(await evaluate(`!!document.querySelector('[data-sidebar] a[href="#/expenses"]')`),false);
    await shot(`zero-${suffix}`,width,height);
    for(const route of ['customers','expenses?tab=employees','promotions','user-management']){await go(route);await until("location.hash==='#/user'&&!!document.querySelector('[data-route-outlet]')");}
    await shot(`zero-direct-route-denied-${suffix}`,width,height);
    await sync(['expenses']);await login('selective');await evaluate(`localStorage.setItem('dhlThemePreference',${JSON.stringify(theme)})`);
    await go('expenses');await until("!!document.getElementById('expense-table-body')&&!document.getElementById('expense-table-body').innerText.includes('Đang tải')");
    assert.ok(await evaluate(`!!document.querySelector('[data-sidebar] a[href="#/expenses"]')`));
    assert.equal(await evaluate(`!!document.querySelector('[data-sidebar] a[href="#/user-management"]')`),false);
    await shot(`selective-expenses-${suffix}`,width,height);
    await go('expenses?tab=employees');await until("!!document.getElementById('employee-add')&&!!document.getElementById('employee-table-body').children.length");
    await shot(`selective-employees-${suffix}`,width,height);
    // Same browser session; focus refresh must rebuild navigation and remove a revoked route.
    await sync([]);await evaluate("window.dispatchEvent(new Event('focus'))");
    await until("location.hash==='#/user'&&!document.querySelector('[data-sidebar] a[href=\"#/expenses\"]')");
    await shot(`revoked-stale-session-${suffix}`,width,height);
    await qa.enqueue(()=>qa.db.query("update user_profiles set status='locked',web_access_enabled=false where user_id=$1",[qaUsers.selective]));
    await evaluate("window.dispatchEvent(new Event('focus'))");await until("!!document.getElementById('login-form')");
    await shot(`disabled-stale-session-${suffix}`,width,height);
    await qa.enqueue(()=>qa.db.query("update user_profiles set status='active',web_access_enabled=true where user_id=$1",[qaUsers.selective]));
    await login('admin');await evaluate(`localStorage.setItem('dhlThemePreference',${JSON.stringify(theme)})`);await go('user-management');
    await until("document.querySelectorAll('[data-user-action]').length===5");
    await shot(`admin-user-list-${suffix}`,width,height);
    await click(`[data-user-id="${qaUsers.selective}"]`);await until("!!document.querySelector('[data-detail-tab=access]')");await click('[data-detail-tab=access]');
    await until("!!document.getElementById('user-permission-form')");
    assert.equal(await evaluate("document.querySelectorAll('[name=permissions]').length"),26);
    await shot(`permission-editor-${suffix}`,width,height);
    await click('[name=permissions][value=expenses]');await click('[data-permission-save]');
    await until("!document.querySelector('[data-permission-confirm-overlay]').classList.contains('hidden')");
    await shot(`permission-confirm-${suffix}`,width,height);
    await fill({'#permission-confirm-form [name=adminPassword]':QA_PASSWORD,'#permission-confirm-form [name=reason]':'Chrome QA grant'});await click('#permission-confirm-form [type=submit]');
    await until("!!document.querySelector('[data-permission-save]')&&document.querySelector('[data-permission-save]').disabled");
    assert.deepEqual((await qa.enqueue(()=>qa.db.query('select permission from user_permissions where user_id=$1',[qaUsers.selective]))).rows.map(x=>x.permission),['expenses']);
    await go('reports');await until("!!document.querySelector('[data-route-outlet]')");await pause(300);await shot(`admin-reports-${suffix}`,width,height);
    await go('logs');await until("!!document.querySelector('[data-route-outlet]')");await pause(300);await shot(`admin-logs-${suffix}`,width,height);
  }
  // Additional real login/signup/logout and permission-specific Settings entrypoints.
  await cdp('Emulation.setDeviceMetricsOverride',{width:1280,height:1000,deviceScaleFactor:1,mobile:false});
  if(!actionsOnly){
  await go('signup');await evaluate('localStorage.clear()');await go('signup');await until("!!document.getElementById('signup-submit')");
  const before=(await qa.enqueue(()=>qa.db.query('select (select count(*) from customers) c,(select count(*) from kiosks) k,(select count(*) from employees) e,(select count(*) from payments) p'))).rows[0];
  await fill({'#signup-username':'qa_chrome_signup','#signup-password':QA_PASSWORD});await click('#signup-submit');await until("!!document.getElementById('login-form')");
  await login('qa_chrome_signup');assert.equal(await evaluate('location.hash'),'#/user');
  assert.deepEqual((await qa.enqueue(()=>qa.db.query('select (select count(*) from customers) c,(select count(*) from kiosks) k,(select count(*) from employees) e,(select count(*) from payments) p'))).rows[0],before);
  await shot('signup-zero-isolation-1280',1280,1000);
  await click('[data-logout]');await until("!!document.querySelector('[data-confirm-logout]')");await click('[data-confirm-logout]');await until("!!document.getElementById('login-form')");
  await shot('logout-1280',1280,1000);
  for(const permission of ['homepage-content','settings']){
    phase=`selective-${permission}`;
    await sync([permission]);await login('selective');await go('settings');await until("!!document.querySelector('[data-settings-workspace-tab]')");
    assert.equal(await evaluate("document.querySelectorAll('[data-settings-workspace-tab]').length"),1);
    assert.equal(await evaluate("document.querySelector('[data-settings-workspace-tab]').dataset.settingsWorkspaceTab"),permission==='settings'?'operations':'website');
    await until(permission==='settings'?"!!document.getElementById('settings-form')":"!!document.getElementById('homepage-content-form')");
    await shot(`selective-${permission}-1280`,1280,1000);
    await go('user');
  }
  }
  phase='admin-module-tour';
  await login('admin');
  for(const route of ['dashboard','customers','customer-detail?id=1','kiosks','kiosk-detail?id=1','registration-requests','payments','expenses','expenses?tab=employees','promotions','reports','logs','settings','homepage-content','user-management']){
    await go(route);await until("!!document.querySelector('[data-route-outlet]')");await pause(400);
    const text=await evaluate("document.querySelector('[data-route-outlet]').innerText");
    assert.doesNotMatch(text,/Không thể tải|Không tải được|permission denied|Unexpected|Không có quyền/i,route);
    await shot(`admin-module-${route.replaceAll(/[^a-z0-9-]/g,'-')}-1280`,1280,1000);
  }
  phase='selective-kiosk-actions';
  await sync(['kiosks','kiosk-detail']);await login('selective');await go('kiosks');
  await until("!!document.getElementById('kiosk-grid')");
  assert.equal(await evaluate("!!document.getElementById('add-kiosk-button')"),false);
  await go('kiosk-detail?id=1');await until("!!document.getElementById('edit-kiosk-detail-button')");
  assert.equal(await evaluate("!!document.getElementById('renew-kiosk-detail-button')"),false);
  await click('#kiosk-detail-action-menu summary');await click('#edit-kiosk-detail-button');await until("!!document.getElementById('kiosk-edit-form')");
  assert.equal(await evaluate("document.getElementById('kiosk-edit-customer').disabled"),true);
  await shot('selective-kiosk-edit-no-customer-grant-1280',1280,1000);
  await fill({'#kiosk-edit-note':'TEST selective kiosk edit','#kiosk-reason':'Chrome QA permission'});await click('#kiosk-edit-save');
  await until("document.querySelector('[data-modal-overlay]').classList.contains('hidden')");
  assert.equal((await qa.enqueue(()=>qa.db.query('select note from kiosks where id=1'))).rows[0].note,'TEST selective kiosk edit');
  await go('user');await sync(['kiosks','kiosk-detail','payments']);await go('kiosk-detail?id=1');
  await until("!!document.getElementById('renew-kiosk-detail-button')");await click('#kiosk-detail-action-menu summary');await click('#renew-kiosk-detail-button');
  await until("!!document.getElementById('renew-kiosk-form')");
  assert.equal(await evaluate("!!document.querySelector('[name=renew-payment-path][value=paid]')"),false);
  assert.equal(await evaluate("document.querySelector('[name=renew-payment-path]:checked').value"),'payos');
  await shot('selective-renewal-payos-only-1280',1280,1000);
  await go('user');
  for(const permission of ['reports','logs']){
    await sync([permission]);await go(permission);await until("!!document.querySelector('[data-route-outlet]')");await pause(400);
    assert.doesNotMatch(await evaluate("document.querySelector('[data-route-outlet]').innerText"),/Không thể tải|Không tải được|permission denied|Không có quyền/i);
    await shot(`selective-${permission}-1280`,1280,1000);await go('user');
  }
  await click('[data-sidebar-account] summary');assert.ok(await evaluate("!!document.querySelector('[data-sidebar-account][open]')"));
  await click('[data-sidebar-account] [data-logout]');await until("!!document.querySelector('[data-confirm-logout]')");
  await click('[data-confirm-logout]');await until("!!document.getElementById('login-form')");
  await shot('account-menu-logout-1280',1280,1000);
  assert.deepEqual(chrome.errors,[]);assert.deepEqual(apiErrors,[]);
}catch(error){results.push({label:'run',pass:false,message:error.stack});console.error(error.stack);process.exitCode=1;}
finally{
  await writeFile(join(out,actionsOnly?'visual-results-actions.json':'visual-results.json'),JSON.stringify({surface:'Installed Chrome headless, actual app/SDK/API handlers and PostgreSQL; local Auth and REST transport. No Production writes.',results,errors:chrome?.errors||[],apiErrors},null,2));
  if(chrome)await chrome.close();server.close();await qa.close();
}
