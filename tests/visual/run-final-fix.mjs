// Actual application + SDK + API handlers + SQL authorization. Only Auth/HTTP transport is local.
import {createPermissionQaBackend,QA_PASSWORD} from '../fixtures/permission-qa-backend.mjs';
import {qaUsers} from '../fixtures/permission-qa-database.mjs';
import {startChrome} from './permission-chrome-driver.mjs';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=resolve(fileURLToPath(new URL('../..',import.meta.url))),out=join(root,'docs/qa/final-fix-v1/chrome');
await mkdir(out,{recursive:true});
let providerMode='ok';const providerOrders=new Map();
const qa=await createPermissionQaBackend({providerFetch:async(url,init)=>{
  if(init.method==='GET'){const data=providerOrders.get(Number(url.pathname.split('/').at(-1)));return new Response(JSON.stringify(data?{code:'00',data}:{code:'404'}),{status:data?200:404});}
  if(providerMode==='reject')return new Response(JSON.stringify({code:'20',desc:'TEST provider failure'}),{status:400});
  const b=JSON.parse(init.body),data={orderCode:b.orderCode,amount:b.amount,id:'link-'+b.orderCode,paymentLinkId:'link-'+b.orderCode,checkoutUrl:origin+'/qa-checkout/'+b.orderCode,status:'PENDING',amountPaid:0};providerOrders.set(b.orderCode,data);return new Response(JSON.stringify({code:'00',data}));
}}),results=[],apiErrors=[];

let phase='initial';
const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost'),path=decodeURIComponent(url.pathname);
  try{
    if(path.startsWith('/qa-checkout/')) {res.writeHead(200,{'Content-Type':'text/html'}).end('<html lang="vi"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><h1>Checkout QA</h1><p>Provider giả lập — không có QR hoặc thanh toán thật.</p></body></html>');return;}
    if(path==='/config.js'||path==='/config.local.js'){res.writeHead(200,{'Content-Type':'text/javascript'}).end(`window.DHL_CONFIG={supabaseUrl:${JSON.stringify(origin)},supabaseAnonKey:'qa-anon'};`);return;}
    if(path.startsWith('/api/')||path.startsWith('/auth/v1/')||path.startsWith('/rest/v1/')){
      let raw='';for await(const chunk of req)raw+=chunk;
      if(path==='/api/facebook-id'){
        const input=JSON.parse(raw||'{}'); const id=String(input.facebook_url||input.url||input.facebookUrl||'').match(/\d{5,30}/)?.[0]||'99999977777';
        res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({success:true,facebook_id:id,facebook_name:'TEST Facebook '+id,facebook_url:'https://www.facebook.com/'+id}));return;
      }
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

process.env.PUBLIC_RENEWAL_TOKEN_SECRET='qa-final-fix-renewal-secret-over-thirty-two';
for(const key of ['PAYOS_CLIENT_ID','PAYOS_API_KEY','PAYOS_CHECKSUM_KEY'])process.env[key]='qa-local-only';
await qa.db.exec("select setval('customers_id_seq',100);select setval('kiosks_id_seq',100)");
const sql=async(query,args=[])=>qa.enqueue(()=>qa.db.query(query,args));
const {asQaUser}=await import('../fixtures/permission-qa-database.mjs');
const rpc=async(name,args=[],user='admin',role=user?'authenticated':'service_role')=>Object.values((await qa.enqueue(()=>asQaUser(qa.db,user,`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')})`,args,{role}))).rows[0])[0];
const initial=await rpc('submit_public_registration',[{facebook_name:'TEST unpaid',phone:'0900000888'},[{facebook_name:'TEST PayOS hết hạn',facebook_id:'99999988888',facebook_link:'https://www.facebook.com/99999988888',business_type_id:1,months:1,discount:0}],null],null);
const batch=await rpc('prepare_registration_checkout_v3',[initial.kiosks.map(x=>x.request.id),'0900000888',null],null);
await rpc('record_registration_payos_order',[batch.payment.id,7001,100000,'TEST',null,null,'link-7001',{expiresAt:Math.floor(Date.now()/1000)-3600}],null);
await rpc('save_employee',[null,'Nhân viên TEST','0900000555','Vận hành','2026-01-01','active','TEST']);
let chrome;
try {
 chrome=await startChrome();const {cdp,evaluate,until,click,pause}=chrome;
 const fill=async(values)=>evaluate(`(()=>{for(const [selector,value] of Object.entries(${JSON.stringify(values)})){const n=document.querySelector(selector);if(!n)throw Error('Missing '+selector);n.value=value;n.dispatchEvent(new Event('input',{bubbles:true}));n.dispatchEvent(new Event('change',{bubbles:true}));}})()`);
 let navigation=0;
 const go=async route=>{await cdp('Page.navigate',{url:`${origin}/index.html?qaNavigation=${++navigation}#/${route}`});await until(`location.search==='?qaNavigation=${navigation}'&&document.readyState==='complete'`);await pause(120);};
 const login=async()=>{await go('login');await evaluate('localStorage.clear();sessionStorage.clear()');await go('login');await until("!!document.getElementById('login-form')");await fill({'#login-username':'qa_admin','#login-password':QA_PASSWORD});await click('#login-submit');await until("!!document.querySelector('[data-route-outlet]')");};
 const shot=async(label,width,height)=>{await evaluate('document.fonts.ready');await pause(120);const m=await evaluate(`({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,theme:document.documentElement.dataset.theme,route:location.hash})`);assert.ok(m.scrollWidth<=width,label+' overflow '+m.scrollWidth);const img=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(join(out,label+'.png'),Buffer.from(img.data,'base64'));results.push({label,pass:true,...m});console.log(label+': PASS');};
 let n=0;
 for(const theme of ['light','dark'])for(const width of theme==='light'?[1440,1280,768,390]:[1280,390]){
  n++;const height=width===390?844:1000,suffix=width+'-'+theme;phase=suffix;
  await cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width===390});await cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme}]});
  await login();await evaluate(`localStorage.setItem('dhlThemePreference',${JSON.stringify(theme)})`);
  await go('customer-detail?id=1');await until("!!document.getElementById('customer-add-kiosk')");await click('#customer-add-kiosk');await until("document.querySelector('#add-kiosk-category option[value=\"1\"]')");
  await fill({'#add-kiosk-facebook-name':'TEST thêm Kiosk '+n,'#add-kiosk-facebook-link':'https://www.facebook.com/9999900000'+n,'#add-kiosk-facebook-id':'9999900000'+n,'#add-kiosk-category':'1'});await fill({'#add-kiosk-business-type':'1'});
  assert.equal(await evaluate("document.getElementById('add-kiosk-customer').value"),'1');assert.equal(await evaluate("document.getElementById('add-kiosk-customer').disabled"),true);
  await shot('customer-add-kiosk-'+suffix,width,height);await click('#add-kiosk-save-button');await until("document.querySelector('[data-modal-overlay]').classList.contains('hidden')");
  const r=(await sql("select id,customer_id,payment_id from registration_requests where facebook_id=$1",['9999900000'+n])).rows[0];assert.equal(r.customer_id,1);
  await until("document.getElementById('customer-detail-content').innerText.includes('TEST thêm Kiosk '+n)".replace('+n','+'+JSON.stringify(n)));await shot('customer-multiple-kiosks-'+suffix,width,height);
  await go('customers');await until("!!document.getElementById('add-customer-button')");await click('#add-customer-button');await fill({'#customer-facebook-name':'Khách hàng TEST','#customer-phone':'0900000001'});await click('#customer-save-button');await until("!!document.querySelector('[data-existing-customer]')");
  await shot('customer-exact-duplicate-'+suffix,width,height);
  if(n===1){
    await fill({'#customer-phone':'0900099999'});
    const savedCount=(await sql('select count(*) as n from customers')).rows[0].n;
    const promise=click('#customer-save-button');await pause(150);await cdp('Page.handleJavaScriptDialog',{accept:false});await promise;
    assert.match(chrome.dialogs.at(-1).message,/thông tin tương tự/);
    assert.equal((await sql('select count(*) as n from customers')).rows[0].n,savedCount);
    await fill({'#customer-phone':'0900000001'});await click('#customer-save-button');await until("!!document.querySelector('[data-existing-customer]')");
  }
  await click('[data-existing-customer]');await until("location.hash.includes('customer-detail')");
  await go('registration-requests');await until("document.getElementById('request-table-body').innerText.includes('TEST PayOS hết hạn')");
  assert.equal(await evaluate("document.getElementById('request-table-body').innerText.includes('Chấp nhận')"),false);
  await shot('registration-mixed-and-badge-'+suffix,width,height);
  assert.equal(await evaluate("document.querySelector('[data-registration-nav-count]').textContent"),'1');
  await click(`[data-request-action=external-complete][data-request-id="${initial.kiosks[0].request.id}"]`);await shot('explicit-external-receipt-'+suffix,width,height);await click('[data-operation-confirm]');await until("document.getElementById('registration-operation-error').innerText.includes('Cần ghi chú')");await click('[data-operation-close]');
  // Accept the actual approval confirmation dialog through CDP.
  const approvePromise=click(`[data-request-action=approve][data-request-id="${r.id}"]`);
  await pause(100);await cdp('Page.handleJavaScriptDialog',{accept:true});await approvePromise;
  await until("document.querySelector('[data-registration-nav-count]').classList.contains('hidden')");await shot('manual-approved-badge-refreshed-'+suffix,width,height);
  assert.equal((await sql('select payment_status from payments where id=$1',[r.payment_id])).rows[0].payment_status,'pending');
  await go('user-management');await until("document.querySelectorAll('[data-user-action]').length===5");await click(`[data-user-id="${qaUsers.selective}"]`);await until("!!document.querySelector('[data-detail-tab=access]')");await click('[data-detail-tab=access]');await until("!!document.getElementById('user-permission-form')");await shot('permissions-editor-'+suffix,width,height);
  await go('expenses?tab=employees');await until("document.getElementById('employee-table-body')?.innerText.includes('Nhân viên TEST')");await shot('employees-'+suffix,width,height);
  await go('promotions');await until("!!document.getElementById('add-promotion')");await click('#add-promotion');await until("!!document.querySelector('#promotion-form')");await shot('promotion-create-'+suffix,width,height);
  // Public registration UI with mocked provider rejection followed by a real retry.
  await go('register');await until("document.querySelector('[data-kiosk-category] option[value=\"1\"]')");
  const publicId='9999910000'+n;
  await fill({'#register-customer-link':'https://www.facebook.com/'+publicId,'#register-customer-id':publicId,'#register-facebook-name':'TEST Public '+n,'#register-phone':'090001000'+n});
  await pause(700);await click('[data-registration-panel="1"] [data-next-step]');await until("!document.querySelector('[data-registration-panel=\"2\"]').classList.contains('hidden')");
  await click('[data-business-manual-toggle]');await fill({'[data-kiosk-category]':'1'});await fill({'[data-kiosk-business-type]':'1'});await click('[data-registration-panel="2"] [data-next-step]');await until("!document.querySelector('[data-registration-panel=\"3\"]').classList.contains('hidden')");
  await click('#register-confirmation');providerMode='reject';await click('#register-submit-button');await until("!!document.querySelector('[data-registration-regenerate]')");await shot('public-registration-provider-error-'+suffix,width,height);
  providerMode='ok';await click('[data-registration-regenerate]');await until("location.pathname.startsWith('/qa-checkout/')");await shot('public-registration-retry-'+suffix,width,height);
  await go('lookup');await until("!!document.getElementById('lookup-form')");await fill({'#lookup-phone':'0900000001'});await click('#lookup-form [type=submit]');await until("!!document.querySelector('[data-renew-index]')");await click('[data-renew-index="0"]');await shot('public-lookup-renewal-'+suffix,width,height);
  await go('');await pause(300);await shot('public-homepage-'+suffix,width,height);
 }
 assert.equal(chrome.errors.length,0,JSON.stringify(chrome.errors));assert.equal(apiErrors.length,0,JSON.stringify(apiErrors));
 await writeFile(join(out,'visual-results.json'),JSON.stringify({results,runtimeErrors:chrome.errors,apiErrors},null,2));console.log('TOTAL '+results.length+' PASS');
} catch(error) {
 console.error(error);await writeFile(join(out,'visual-results.json'),JSON.stringify({results,error:error.message,runtimeErrors:chrome?.errors,apiErrors},null,2));process.exitCode=1;
} finally {await chrome?.close();await new Promise(resolve=>server.close(resolve));await qa.close();}
