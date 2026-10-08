// Actual application + SDK + API handlers + SQL authorization. Only Auth/HTTP transport is local.
import {createPermissionQaBackend,QA_PASSWORD} from '../fixtures/permission-qa-backend.mjs';
import {qaUsers} from '../fixtures/permission-qa-database.mjs';
import {startChrome} from './permission-chrome-driver.mjs';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir,mkdtemp,rename} from 'node:fs/promises';
import {resolve,join,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {seedFollowupReports} from '../fixtures/followup-qa-seed.mjs';
import assert from 'node:assert/strict';
import {tmpdir} from 'node:os';
const root=resolve(fileURLToPath(new URL('../..',import.meta.url))),out=join(root,'docs/qa/production-followup-fix/chrome');
await mkdir(out,{recursive:true});
const qa=await createPermissionQaBackend({facebookFetch:async()=>new Response(JSON.stringify({error:'Xác minh reCAPTCHA thất bại',code:403}))}),results=[],apiErrors=[];

let phase='initial';
const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost'),path=decodeURIComponent(url.pathname);
  try{
    if(path==='/config.js'||path==='/config.local.js'){res.writeHead(200,{'Content-Type':'text/javascript'}).end(`window.DHL_CONFIG={supabaseUrl:${JSON.stringify(origin)},supabaseAnonKey:'qa-anon'};`);return;}
    if(path.startsWith('/api/')||path.startsWith('/auth/v1/')||path.startsWith('/rest/v1/')){
      let raw='';for await(const chunk of req)raw+=chunk;
      if(path.startsWith('/api/')){
        const result=await qa.invoke(path,raw?JSON.parse(raw):{},String(req.headers.authorization||'').replace(/^Bearer /i,''),Object.fromEntries(url.searchParams),req.method);
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

await seedFollowupReports(qa.db);
await qa.db.exec("set session_replication_role=replica;update payments set total_amount=total_amount*1000,price_per_month=price_per_month*1000;update expenses set amount=amount*1000;set session_replication_role=origin;select setval('kiosks_id_seq',50);select setval('customers_id_seq',50)");
await qa.db.exec("update kiosks set facebook_link='https://facebook.com/9999990001' where id=1");
const {asQaUser}=await import('../fixtures/permission-qa-database.mjs');
const rpc=async(name,args=[])=>Object.values((await qa.enqueue(()=>asQaUser(qa.db,'admin',`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')})`,args))).rows[0])[0];
const sql=(query,args=[])=>qa.enqueue(()=>qa.db.query(query,args));
const downloads=await mkdtemp(join(tmpdir(),'dhl-followup-export-'));const exportOut=join(out,'exports');await mkdir(exportOut,{recursive:true});
let chrome;
try {
 chrome=await startChrome();const {cdp,evaluate,until,click,pause}=chrome;
 await cdp('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads});
 // Browser timezone is deliberately not VN; pure dates and filter days must still be VN.
 await cdp('Emulation.setTimezoneOverride',{timezoneId:'America/Los_Angeles'});
 const fill=async(values)=>evaluate(`(()=>{for(const [selector,value] of Object.entries(${JSON.stringify(values)})){const n=document.querySelector(selector);if(!n)throw Error('Missing '+selector);n.value=value;n.dispatchEvent(new Event('input',{bubbles:true}));n.dispatchEvent(new Event('change',{bubbles:true}));}})()`);
 let navigation=0;
 const go=async route=>{await cdp('Page.navigate',{url:`${origin}/index.html?qaNavigation=${++navigation}#/${route}`});await until(`location.search==='?qaNavigation=${navigation}'&&document.readyState==='complete'`);await pause(120);};
 const login=async()=>{await go('login');await evaluate('localStorage.clear();sessionStorage.clear()');await go('login');await until("!!document.getElementById('login-form')");await fill({'#login-username':'qa_admin','#login-password':QA_PASSWORD});await click('#login-submit');await until("!!document.querySelector('[data-route-outlet]')");};
 const shot=async(label,width)=>{await evaluate('document.fonts.ready');await pause(120);const m=await evaluate(`({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,theme:document.documentElement.dataset.theme,route:location.hash})`);assert.ok(m.scrollWidth<=width,label+' overflow '+m.scrollWidth);const img=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(join(out,label+'.png'),Buffer.from(img.data,'base64'));results.push({label,pass:true,...m});console.log(label+': PASS');};
 let n=0;
 for(const theme of ['light','dark'])for(const width of theme==='light'?[1440,1280,768,390]:[1280,390]){
  n++;const height=width===390?844:1000,suffix=width+'-'+theme;phase=suffix;
  await cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width===390});await cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme}]});
  await login();await evaluate(`localStorage.setItem('dhlThemePreference',${JSON.stringify(theme)})`);
  await go('reports');await until("!!document.querySelector('.report-revenue-stats')");
  assert.match(await evaluate("document.querySelector('.report-revenue-stats').innerText"),/Lợi nhuận ròng năm/);
  assert.equal(await evaluate("document.querySelector('#report-start-date-display').placeholder"),'DD/MM/YYYY');
  await shot('reports-default-'+suffix,width);
  await fill({'#report-start-date-display':'01/08/2026','#report-end-date-display':'31/08/2026'});await until("document.querySelector('.report-revenue-stats')?.innerText.includes('Chi tiêu tháng 8')");
  assert.match(await evaluate("document.querySelector('.report-revenue-stats').innerText"),/350.000/);
  assert.match(await evaluate("document.querySelector('.report-revenue-stats').innerText"),/275.000/);
  const months=await evaluate("document.querySelector('.report-grid .report-card').innerText");assert.match(months,/08\/2026/);assert.doesNotMatch(months,/09\/2026/);
  await shot('reports-selected-month-'+suffix,width);
  await fill({'#report-start-date-display':'01/06/2025','#report-end-date-display':'30/06/2025'});await until("document.querySelector('.report-revenue-stats')?.innerText.includes('Doanh thu năm 2025')&&document.querySelector('.report-revenue-stats')?.innerText.includes('Chi tiêu tháng 6')");
  assert.match(await evaluate("document.querySelector('.report-revenue-stats').innerText"),/1.500.000/);
  await shot('reports-historical-month-'+suffix,width);
  await fill({'#report-start-date-display':'15/08/2025','#report-end-date-display':'20/03/2026'});await until("document.querySelector('.report-revenue-stats')?.innerText.includes('Lợi nhuận ròng trong kỳ')");
  assert.doesNotMatch(await evaluate("document.querySelector('.report-revenue-stats').innerText"),/Doanh thu tháng/);await shot('reports-arbitrary-range-'+suffix,width);
  await fill({'#report-start-date-display':'01/08/2026','#report-end-date-display':'31/08/2026','#report-search':'200000'});await until("document.querySelector('.report-revenue-stats')?.innerText.includes('200.000')&&document.querySelector('.report-revenue-stats')?.innerText.includes('125.000')");
  assert.equal(await evaluate("document.querySelectorAll('#reports-content > .report-card tbody tr').length"),1);
  await shot('reports-search-and-export-'+suffix,width);await click('#report-export-button');await until("!document.querySelector('#report-export-button').disabled");
  let csv;for(let retry=0;retry<100;retry++){try {csv=await readFile(join(downloads,'bao-cao-revenue.csv'),'utf8');if(csv.includes('200000'))break;}catch{}await pause(50);}
  assert.ok(csv?.includes('200000'));assert.equal(csv.trim().split('\n').length,2);await rename(join(downloads,'bao-cao-revenue.csv'),join(exportOut,'bao-cao-revenue-'+suffix+'.csv'));
  const manual=await rpc('submit_existing_customer_kiosk',[1,{facebook_name:'TEST chờ duyệt '+n,facebook_id:'9999970010'+n,facebook_link:'https://facebook.com/9999970010'+n,business_type_id:1,months:1}]);
  await go('registration-requests');await until("document.querySelector('[data-registration-nav-count]')?.innerText==='1'");
  await click('.admin-notification-center summary');await until("!!document.querySelector('.admin-notification-item.is-unread')");await shot('notifications-unread-'+suffix,width);
  await click('[data-notification-mark-all]');assert.equal(await evaluate("document.querySelector('[data-notification-count]').classList.contains('hidden')"),true);assert.equal(await evaluate("document.querySelector('[data-registration-nav-count]').textContent"),'1');
  await until("document.querySelector('[data-notification-mark-all]')?.disabled");await shot('notifications-read-actionable-'+suffix,width);
  await rpc('approve_registration_request',[manual.request.id]);await evaluate("window.dispatchEvent(new Event('dhl:actionable-registration-changed'))");await until("document.querySelector('[data-registration-nav-count]')?.classList.contains('hidden')&&document.querySelector('[data-notification-list]')?.innerText.includes('Đã duyệt')");
  await shot('notifications-resolved-history-'+suffix,width);
  await go('expenses?tab=employees');await until("!!document.querySelector('#employee-add')");await click('#employee-add');await until("!!document.querySelector('[data-date-display=startDate]')");
  await fill({'#employee-form [name=fullName]':'TEST ngày '+n});await evaluate("document.querySelector('[data-date-display=startDate]').focus()");await cdp('Input.insertText',{text:'03102026'});await evaluate("document.querySelector('[data-date-display=startDate]').blur()");
  assert.equal(await evaluate("new FormData(document.querySelector('#employee-form')).get('startDate')"),'2026-10-03');
  await shot('employee-date-create-'+suffix,width);await click('#employee-form [type=submit]');await until("document.querySelector('[data-modal-overlay]').classList.contains('hidden')");
  const employee=(await sql('select id,start_date::text from employees where full_name=$1',['TEST ngày '+n])).rows[0];assert.equal(employee.start_date,'2026-10-03');
  await until(`!!document.querySelector('[data-employee-action=edit][data-employee-id="${employee.id}"]')`);await click(`[data-employee-action=edit][data-employee-id="${employee.id}"]`);await until("document.querySelector('[data-date-display=startDate]')?.value==='03/10/2026'");
  await fill({'[data-date-display=startDate]':'31/02/2026'});assert.equal(await evaluate("document.querySelector('[data-date-display=startDate]').checkValidity()"),false);await click('#employee-form [type=submit]');assert.equal((await sql('select start_date::text from employees where id=$1',[employee.id])).rows[0].start_date,'2026-10-03');
  await fill({'[data-date-display=startDate]':''});assert.equal(await evaluate("new FormData(document.querySelector('#employee-form')).get('startDate')"),'');await fill({'[data-date-display=startDate]':'04/10/2026'});await shot('employee-date-edit-'+suffix,width);await click('#employee-form [type=submit]');await until("document.querySelector('[data-modal-overlay]').classList.contains('hidden')");
  assert.equal((await sql('select start_date::text from employees where id=$1',[employee.id])).rows[0].start_date,'2026-10-04');
  await go('kiosks');await until("!!document.querySelector('#add-kiosk-button')");await click('#add-kiosk-button');await until("!!document.querySelector('#kiosk-edit-start-date-display')");await fill({'#kiosk-edit-start-date-display':'03/10/2026','#kiosk-edit-end-date-display':'31/12/2026'});
  assert.equal(await evaluate("document.querySelector('#kiosk-edit-start-date').value"),'2026-10-03');assert.equal(await evaluate("document.querySelector('#kiosk-edit-end-date').value"),'2026-12-31');await evaluate("document.querySelector('#kiosk-edit-start-date-display').scrollIntoView({block:'center'})");await shot('kiosk-date-create-'+suffix,width);
  await fill({'#kiosk-edit-fb-link':'https://facebook.com/QA.Username'+n});await click('#kiosk-edit-form [data-facebook-id-resolve]');await until("document.querySelector('#kiosk-edit-form [data-facebook-id-resolver]')?.dataset.resolverState==='provider-blocked'");
  assert.equal(await evaluate("document.querySelector('#kiosk-edit-fb-id').readOnly"),false);await fill({'#kiosk-edit-fb-id':'10000123456789'+n});
  assert.match(await evaluate("document.querySelector('#kiosk-edit-form [data-facebook-id-status]').innerText"),/nhập Facebook ID thủ công/);await evaluate("document.querySelector('#kiosk-edit-fb-id').scrollIntoView({block:'center'})");await shot('facebook-provider-blocked-manual-'+suffix,width);
  await fill({'#kiosk-edit-name':'TEST manual fallback '+n,'#kiosk-edit-customer':'1','#kiosk-edit-category':'1'});await fill({'#kiosk-edit-business-type':'1'});await click('#kiosk-edit-save');await until("document.querySelector('[data-modal-overlay]').classList.contains('hidden')");
  const savedKiosk=(await sql('select start_date::text,end_date::text from kiosks where facebook_id=$1',['10000123456789'+n])).rows[0];assert.equal(savedKiosk.start_date,'2026-10-03');assert.equal(savedKiosk.end_date,'2026-12-31');
  await go('kiosk-detail?id=1');await until("!!document.querySelector('.kiosk-detail-action-menu')");await click('.kiosk-detail-action-menu summary');await click('#edit-kiosk-detail-button');await until("!!document.querySelector('#kiosk-edit-start-date-display')");
  assert.ok(await evaluate("document.querySelector('#kiosk-edit-start-date-display').value.includes('/')"));await evaluate("document.querySelector('#kiosk-edit-start-date-display').scrollIntoView({block:'center'})");await shot('kiosk-date-edit-roundtrip-'+suffix,width);await click('#kiosk-edit-form [data-cancel]');
 }
 const files=await (await import('node:fs/promises')).readdir(exportOut);assert.equal(files.filter(x=>x.startsWith('bao-cao-revenue-')&&x.endsWith('.csv')).length,6);
 for(const name of files.filter(x=>x.endsWith('.csv'))){const csv=await readFile(join(exportOut,name),'utf8');assert.ok(csv.includes('200000'));assert.ok(!csv.includes('400000'));assert.equal(csv.trim().split('\n').length,2);}
 assert.equal(chrome.errors.length,0,JSON.stringify(chrome.errors));assert.equal(apiErrors.length,0,JSON.stringify(apiErrors));
 await writeFile(join(out,'visual-results.json'),JSON.stringify({results,runtimeErrors:chrome.errors,apiErrors,timezone:'America/Los_Angeles',csvExports:files.filter(x=>x.endsWith('.csv'))},null,2));console.log('TOTAL '+results.length+' PASS');
} catch(error) {
 console.error(error);await writeFile(join(out,'visual-results.json'),JSON.stringify({results,error:error.message,runtimeErrors:chrome?.errors,apiErrors},null,2));process.exitCode=1;
} finally {await chrome?.close();await new Promise(resolve=>server.close(resolve));await qa.close();}
