// Real index.html/app bootstrap/Supabase SDK. Isolated local Auth + PostgREST adapter + Postgres.
// Never loads config.local.js from disk or connects to production.
import { createPromotionQaDatabase, promotionQaActor } from '../fixtures/promotion-qa-database.mjs';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root=resolve(fileURLToPath(new URL('../..',import.meta.url))),out=join(root,'docs/qa/promotions-ux');
await mkdir(out,{recursive:true});
const db=await createPromotionQaDatabase();
const scalar=async(sql,p=[])=>Object.values((await db.query(sql,p)).rows[0])[0];
const baseline=await scalar('select jsonb_agg(to_jsonb(p) order by id) from public.promotions p');
const profile=await mkdtemp(join(tmpdir(),'dhl-promotion-ux-'));
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const calls=[],apiErrors=[];
let queue=Promise.resolve();
const user={id:promotionQaActor,aud:'authenticated',role:'authenticated',email:'qa@example.invalid',factors:[],app_metadata:{},user_metadata:{},created_at:'2026-01-01T00:00:00Z'};
const send=(res,status,data)=>res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify(data));
const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost'),path=decodeURIComponent(url.pathname);
  if(path==='/qa/reset'){await queue;await db.exec('reset role; rollback; begin; set role authenticated');calls.length=0;send(res,200,{count:await scalar('select count(*) from public.promotions')});return;}
  if(path==='/auth/v1/user'){send(res,200,user);return;}
  if(path==='/config.js'||path==='/config.local.js'){
    res.writeHead(200,{'Content-Type':'text/javascript'}).end(`window.DHL_CONFIG={supabaseUrl:${JSON.stringify(`http://127.0.0.1:${server.address().port}`)},supabaseAnonKey:'local-qa-only'};`);return;
  }
  if(path.startsWith('/rest/v1/')){
    let body='';for await(const chunk of req)body+=chunk;
    queue=queue.then(async()=>{
      await db.exec('savepoint api_request');
      try{
        let data;
        if(path.startsWith('/rest/v1/rpc/')){
          const name=path.split('/').at(-1),args=body?JSON.parse(body):{};calls.push({name,args});
          // Ancillary app-shell data is empty in this isolated QA environment.
          if(name==='get_my_wallet')data={balance:0};
          else if(name==='get_registration_actionable_summary')data={};
          else {
            if(!['get_my_access_profile','get_public_organization_settings','admin_save_promotion'].includes(name))throw Error(`RPC outside QA scope: ${name}`);
            const keys=Object.keys(args);if(keys.some(key=>!/^\w+$/.test(key)))throw Error('Invalid RPC parameter');
            data=await scalar(`select public.${name}(${keys.map((key,i)=>`${key}=>$${i+1}`).join(',')})`,Object.values(args));
          }
        } else if(path==='/rest/v1/promotions'){
          if(req.method!=='GET')throw Error('Only promotion save RPC is writable in QA');
          data=await scalar(`select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object(
            'promotion_categories',(select coalesce(jsonb_agg(to_jsonb(pc)||jsonb_build_object('categories',to_jsonb(c))),'[]') from public.promotion_categories pc join public.categories c on c.id=pc.category_id where pc.promotion_id=p.id),
            'promotion_business_types',(select coalesce(jsonb_agg(to_jsonb(pb)||jsonb_build_object('business_types',to_jsonb(bt))),'[]') from public.promotion_business_types pb join public.business_types bt on bt.id=pb.business_type_id where pb.promotion_id=p.id),
            'promotion_usages','[]'::jsonb) order by p.id),'[]') from public.promotions p`);
        } else if(path==='/rest/v1/categories')data=(await db.query('select * from public.categories order by name')).rows;
        else if(path==='/rest/v1/business_types')data=(await db.query('select bt.*,jsonb_build_object(\'id\',c.id,\'name\',c.name) categories from public.business_types bt join public.categories c on c.id=bt.category_id order by bt.category_id,bt.name')).rows;
        else throw Error(`REST outside QA scope: ${path}`);
        await db.exec('release savepoint api_request');
        res.setHeader('Content-Range',`0-${Math.max(0,(data?.length||1)-1)}/${data?.length||1}`);send(res,200,data);
      }catch(error){await db.exec('rollback to savepoint api_request; release savepoint api_request');apiErrors.push({path,message:error.message});send(res,400,{message:error.message,code:error.code});}
    });await queue;return;
  }
  if(path!=='/'&&path!=='/index.html'&&!/^\/(src|shared|images)\//.test(path)){res.writeHead(404).end();return;}
  if(path.includes('..')){res.writeHead(403).end();return;}
  try{const bytes=await readFile(join(root,path==='/'?'index.html':path));res.writeHead(200,{'Content-Type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'}[extname(path).toLowerCase()]||'text/html','Cache-Control':'no-store'}).end(bytes);}catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const port=server.address().port;
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
  '--disable-component-update', '--disable-sync', '--hide-scrollbars', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
], { stdio: ['ignore', 'ignore', 'ignore'] });
let ws;
const pending = new Map();
let nextId = 0;
let sessionId;
const errors = [];
const results = [];
function cdp(method, params = {}, session = sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, 15000);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject });
    ws.send(JSON.stringify({ id, method, params, ...(session ? { sessionId: session } : {}) }));
  });
}
async function evaluate(expression) {
  const response = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text + ': ' + response.exceptionDetails.exception?.description);
  return response.result.value;
}
async function until(expression){for(let n=0;n<160;n++){if(await evaluate(expression))return;await pause(50);}throw Error(`UI timeout ${expression}; ${JSON.stringify({errors,apiErrors,body:await evaluate('document.body.innerText')})}`);}
async function click(selector){await evaluate(`(()=>{const node=document.querySelector(${JSON.stringify(selector)});if(!node)throw Error('Missing control');node.scrollIntoView({block:'nearest'});node.click();})()`);}
async function fields(values){await evaluate(`(()=>{const form=document.getElementById('promotion-form');for(const [key,value] of Object.entries(${JSON.stringify(values)})){form.elements[key].value=value;form.elements[key].dispatchEvent(new Event('input',{bubbles:true}));form.elements[key].dispatchEvent(new Event('change',{bubbles:true}));}})()`);}
async function edit(id,action='edit'){await click(`#promotions-body tr:has([data-promotion-id="${id}"]) [data-promotion-menu-trigger]`);await click(`[data-promotion-id="${id}"][data-promotion-action="${action}"]`);await until(action==='edit'?`!!document.getElementById('promotion-form')&&!document.querySelector('[data-modal-overlay]').classList.contains('hidden')`:`!document.querySelector('[data-modal-overlay]').classList.contains('hidden')`);}
try{
  let portFile;
  for(let n=0;n<100;n++){try{portFile=(await readFile(join(profile,'DevToolsActivePort'),'utf8')).trim().split('\n');break;}catch{await pause(100);}}
  if(!portFile)throw Error('Chrome unavailable');
  ws=new WebSocket(`ws://127.0.0.1:${portFile[0]}${portFile[1]}`);
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  ws.onmessage=event=>{const m=JSON.parse(event.data);if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);if(m.error)p.reject(Error(m.error.message));else p.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')errors.push({name:'browser',message:m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text});};
  const target=await cdp('Target.createTarget',{url:'about:blank'},null);
  sessionId=(await cdp('Target.attachToTarget',{targetId:target.targetId,flatten:true},null)).sessionId;
  await cdp('Runtime.enable');await cdp('Page.enable');
  const token=`${Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')}.${Buffer.from(JSON.stringify({sub:promotionQaActor,role:'authenticated',aud:'authenticated',aal:'aal1',exp:4102444800})).toString('base64url')}.local-qa-signature`;
  await cdp('Page.addScriptToEvaluateOnNewDocument',{source:`if(location.hostname==='127.0.0.1'){window.qaCase=new URLSearchParams(location.search).get('case');localStorage.setItem('sb-127-auth-token',JSON.stringify(${JSON.stringify({access_token:token,refresh_token:'local-qa-refresh',token_type:'bearer',expires_in:3600,expires_at:4102444800,user})}));localStorage.setItem('dhlThemePreference',new URLSearchParams(location.search).get('theme')||'light');}`});
  const states=['list','create-overview','create-timed','create-unlimited','edit-timed','edit-unlimited','switch-mode','validation','detail-timed','detail-unlimited','many-scopes'];
  for(const theme of ['light','dark'])for(const width of theme==='light'?[1440,1280,768,390]:[1280,390])for(const state of states){
    const height=width===390?844:1000,label=`${state}-${width}-${theme}`;
    assert.equal((await (await fetch(`http://127.0.0.1:${port}/qa/reset`)).json()).count,4);
    await cdp('Emulation.setTimezoneOverride',{timezoneId:theme==='light'?'America/Los_Angeles':'Europe/Berlin'});
    await cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width===390});
    await cdp('Page.navigate',{url:`http://127.0.0.1:${port}/index.html?theme=${theme}&case=${label}#/promotions`});
    await until(`window.qaCase===${JSON.stringify(label)}&&document.readyState==='complete'`);
    await until(`document.querySelectorAll('#promotions-body tr').length===4`);
    if(state.startsWith('create')){await click('#add-promotion');await until(`!!document.getElementById('promotion-form')`);}
    if(state==='create-unlimited')await click('[name="time_mode"][value="unlimited"]');
    if(['create-timed','create-unlimited'].includes(state))await fields({code:'TRIAN2026',name:'Tri ân khách hàng',discount_value:'20'});
    if(state==='edit-timed'||state==='validation'||state==='switch-mode')await edit(state==='switch-mode'?4:1);
    if(state==='edit-unlimited')await edit(2);
    if(state.startsWith('detail'))await edit(state==='detail-timed'?1:2,'details');
    if(state==='many-scopes')await edit(3);
    if(state==='switch-mode'){await click('[name="time_mode"][value="unlimited"]');await click('[name="time_mode"][value="timed"]');}
    if(state==='validation'){await fields({discount_value:'101'});await click('#promotion-form [type="submit"]');}
    if(['create-timed','create-unlimited','edit-timed','edit-unlimited','switch-mode'].includes(state))await evaluate(`document.querySelector('.promotion-time-modes').closest('section').scrollIntoView({block:'start'})`);
    if(state==='many-scopes')await evaluate(`document.querySelector('[data-scope-picker="category"]').scrollIntoView({block:'start'})`);
    await evaluate('document.fonts.ready');await pause(100);
    const metrics=await evaluate(`(()=>{const rect=n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};const modal=document.querySelector('[data-modal]'),opened=!document.querySelector('[data-modal-overlay]').classList.contains('hidden'),form=document.getElementById('promotion-form'),save=form?.querySelector('[type="submit"]');return {width:innerWidth,scrollWidth:document.documentElement.scrollWidth,modal:opened?rect(modal):null,save:save?rect(save):null,focusVisible:!!document.activeElement?.matches(':focus-visible'),mode:form?.elements.time_mode.value,startMode:form?.elements.start_mode.value,start:form?.elements.starts_at.value,end:form?.elements.ends_at.value,endDisabled:form?.elements.ends_at.disabled,preview:form?.querySelector('[data-promotion-preview]').innerText,error:form?.querySelector('#promotion-form-error').innerText,detail:opened&&!form?document.querySelector('[data-modal-body]').innerText:'',text:document.querySelector('[data-route-outlet]').innerText,controls:form?[...form.querySelectorAll('button,.promotion-time-modes label')].filter(n=>n.getClientRects().length).map(rect):[]};})()`);
    try{
      assert.ok(metrics.scrollWidth<=width,'Viewport overflow');
      if(metrics.modal)assert.ok(metrics.modal.x>=0&&metrics.modal.y>=0&&metrics.modal.right<=width&&metrics.modal.bottom<=height+1,'Modal outside viewport');
      if(metrics.save)assert.ok(metrics.save.y>=0&&metrics.save.bottom<=metrics.modal.bottom-1,'Hidden/clipped Save button');
      if(state==='create-overview')assert.ok(metrics.focusVisible,'Keyboard focus is not visible');
      for(const control of metrics.controls)assert.ok(control.height>=44,'Small form action');
      if(state.includes('unlimited')&&metrics.mode){assert.equal(metrics.mode,'unlimited');assert.equal(metrics.endDisabled,true);assert.match(metrics.preview,/Không giới hạn thời gian/);}
      if(state==='edit-timed'){assert.equal(metrics.start,'2020-01-01T10:12:45.123');assert.equal(metrics.end,'2099-12-31T23:59:42.654');}
      if(state==='switch-mode'){assert.equal(metrics.startMode,'immediate');assert.ok(metrics.end);}
      if(state==='validation'){assert.match(metrics.error,/100%/);assert.equal(calls.filter(c=>c.name==='admin_save_promotion').length,0);}
      if(state==='detail-unlimited')assert.match(metrics.detail,/Không giới hạn thời gian/);
      if(state.startsWith('detail'))assert.match(metrics.detail,/Đăng ký mới và gia hạn/);
      assert.doesNotMatch(metrics.text+metrics.preview+metrics.detail,/NULL|nullable|rule JSON|Xóa thời gian/);
      const shot=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(join(out,`${label}.png`),Buffer.from(shot.data,'base64'));
      if(theme==='light'){
        if(['create-timed','create-unlimited'].includes(state)){
          await fields({code:`QA${width}${state==='create-timed'?'T':'U'}`,name:'Kiểm thử tạo chương trình',discount_value:'15'});
          await evaluate(`document.querySelector('#promotion-form [type="submit"]').click();document.querySelector('#promotion-form [type="submit"]').click()`);
          await until(`document.querySelector('[data-modal-overlay]').classList.contains('hidden')&&document.querySelectorAll('#promotions-body tr').length===5`);
          assert.equal(calls.filter(c=>c.name==='admin_save_promotion').length,1);
          const sent=calls.find(c=>c.name==='admin_save_promotion').args.promotion_input;
          if(state==='create-unlimited')assert.equal(sent.ends_at,null);else assert.ok(sent.ends_at);
          const savedId=await scalar('select max(id) from public.promotions');await edit(savedId);
          assert.deepEqual(await evaluate(`(()=>{const f=document.getElementById('promotion-form');return [f.elements.starts_at.value,f.elements.ends_at.value,f.elements.time_mode.value]})()`),[metrics.start,metrics.end,metrics.mode]);
        }else if(['edit-timed','edit-unlimited'].includes(state)){
          await click('#promotion-form [type="submit"]');await until(`document.querySelector('[data-modal-overlay]').classList.contains('hidden')`);await queue;
          const id=state==='edit-timed'?1:2;const saved=await scalar('select to_jsonb(p) from public.promotions p where id=$1',[id]);
          const before=structuredClone(baseline.find(p=>p.id===id));delete before.updated_at;delete saved.updated_at;assert.deepEqual(saved,before);
          await edit(id);assert.equal(await evaluate(`document.getElementById('promotion-form').elements.time_mode.value`),state==='edit-timed'?'timed':'unlimited');
        }else if(state==='switch-mode'){
          await click('[data-cancel]');assert.equal(calls.filter(c=>c.name==='admin_save_promotion').length,0);assert.deepEqual(await scalar('select to_jsonb(p) from public.promotions p where id=4'),baseline.find(p=>p.id===4));
        }else if(state==='validation'){
          await fields({discount_value:'20',ends_at:'2019-01-01T00:00'});await click('#promotion-form [type="submit"]');assert.match(await evaluate(`document.getElementById('promotion-form-error').innerText`),/kết thúc/);
          assert.equal(calls.filter(c=>c.name==='admin_save_promotion').length,0);
        }
        if(metrics.modal){await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});await cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape'});assert.ok(await evaluate(`document.querySelector('[data-modal-overlay]').classList.contains('hidden')`));if(state==='create-overview')assert.equal(calls.filter(c=>c.name==='admin_save_promotion').length,0);}
      }
      results.push({label,pass:true,...metrics,text:undefined,preview:undefined,detail:undefined});console.log(`${label}: PASS`);
    }catch(error){errors.push({name:label,message:error.message});results.push({label,pass:false});console.log(`${label}: FAIL ${error.message}`);}
  }
  await writeFile(join(out,'visual-results.json'),JSON.stringify({surface:'Real index.html + src/app.js + actual Supabase SDK and services; local Auth/PostgREST adapter and actual Postgres promotion RPC. No production mutation.',results,errors,apiErrors},null,2));
  console.log(JSON.stringify({screenshots:results.length,errors,apiErrors},null,2));if(errors.length||apiErrors.length)process.exitCode=1;
}finally{if(ws?.readyState===1){try{await cdp('Browser.close',{},null);}catch{}ws.close();}chrome.kill('SIGTERM');server.close();await db.close();}
