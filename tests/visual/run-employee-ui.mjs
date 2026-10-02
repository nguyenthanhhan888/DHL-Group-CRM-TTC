// Run: node tests/visual/run-employee-ui.mjs
// Isolated Chrome + actual application services and local Postgres. No Production access.
import { createEmployeeQaDatabase } from '../fixtures/employee-qa-database.mjs';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { resolve, extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const out = join(root, 'docs/qa/employees-v1');
const { db, id: actorId, baseline, migrated } = await createEmployeeQaDatabase();
await mkdir(out, { recursive: true });
await writeFile(join(out,'production-contract-simulation.json'),JSON.stringify({description:'Local simulation of the audited single unassigned 450000 VND expense; no production writes',before:baseline,after:migrated},null,2));
let rpcQueue=Promise.resolve();
const profile = await mkdtemp(join(tmpdir(), 'dhl-ui-qa-'));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (path === '/qa/reset') {
    await rpcQueue;
    await db.exec('reset role; rollback; begin; set role authenticated');
    res.writeHead(200, {'Content-Type':'application/json'}).end('{}'); return;
  }
  if (path === '/qa/revoke') {
    await rpcQueue; await db.exec('reset role');
    await db.query("delete from public.user_permissions where user_id=$1 and permission='expenses'",[actorId]);
    await db.exec('set role authenticated');res.writeHead(200).end('{}');return;
  }
  if (path === '/qa/rpc' && req.method === 'POST') {
    let body=''; for await (const chunk of req) body+=chunk;
    const task=async()=>{
      let data=null,error=null;
      await db.exec('savepoint qa_rpc');
      try {
        const {name,args}=JSON.parse(body);
        if (!['get_employees_data','save_employee','set_employee_lifecycle','get_employee_expenses_data','save_employee_expense','check_employee_salary_duplicate'].includes(name)) throw Error('Local RPC not allowlisted');
        const keys=Object.keys(args);if(keys.some(k=>!/^p_[a-z_]+$/.test(k)))throw Error('Invalid argument');
        const sql=`select public.${name}(${keys.map((k,i)=>`${k}=>$${i+1}`).join(',')}) value`;
        data=(await db.query(sql,keys.map(k=>args[k]))).rows[0].value;
      } catch (e) { error={message:e.message,code:e.code}; await db.exec('rollback to savepoint qa_rpc'); }
      await db.exec('release savepoint qa_rpc');
      res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({data,error}));
    };
    rpcQueue=rpcQueue.then(task);await rpcQueue;return;
  }
  if (!/^\/(src|shared|images|tests\/visual)\//.test(path) || path.includes('..')) { res.writeHead(403).end(); return; }
  try {
    const bytes = await readFile(join(root, path));
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' }[extname(path).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store' }).end(bytes);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
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
async function ready() {
  for (let n = 0; n < 100; n++) { if (await evaluate('window.qaReady === true')) return; await pause(50); }
  throw new Error('QA fixture did not render: '+JSON.stringify({errors,body:await evaluate('document.body.innerText')}));
}
async function check(name, fn) {
  try { await fn(); } catch (error) { errors.push({ name, message: error.message }); }
}
try {
  let portFile;
  for (let n = 0; n < 100; n++) {
    try { portFile = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).trim().split('\n'); break; } catch { await pause(100); }
  }
  if (!portFile) throw new Error('Chrome debugging port unavailable');
  ws = new WebSocket(`ws://127.0.0.1:${portFile[0]}${portFile[1]}`);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  ws.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const p = pending.get(message.id); pending.delete(message.id);
      if (message.error) p.reject(new Error(message.error.message)); else p.resolve(message.result);
    }
    if (message.method === 'Runtime.exceptionThrown') errors.push({ name: 'browser exception', message: message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text });
  };
  const target = await cdp('Target.createTarget', { url: 'about:blank' }, null);
  sessionId = (await cdp('Target.attachToTarget', { targetId: target.targetId, flatten: true }, null)).sessionId;
  await cdp('Runtime.enable'); await cdp('Page.enable');
  const pages=['employee-list','employee-create','employee-edit','employee-detail','employee-archived','expense-filters','expense-create','expense-edit','expense-archived','expense-detail'];
  for(const theme of ['light','dark']) for(const width of theme==='light'?[1440,1280,768,390]:[1280,390]) for(const page of pages){
    const label=`${page}-${width}-${theme}`;
    const height=width===390?844:1000;
    await fetch(`http://127.0.0.1:${port}/qa/reset`);
    await cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width===390});
    await cdp('Page.navigate',{url:`http://127.0.0.1:${port}/tests/visual/employee-ui.html?page=${page}&theme=${theme}`});
    await ready();await evaluate('document.fonts.ready');await pause(350);
    const metrics=await evaluate(`(()=>{
      const rect=n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
      const visible=n=>n.getClientRects().length&&getComputedStyle(n).visibility!=='hidden';
      const overlay=document.querySelector('[data-modal-overlay]');
      return {width:innerWidth,scrollWidth:document.documentElement.scrollWidth,
        fontLoaded:[...document.fonts].some(f=>f.family.includes('Be Vietnam Pro')&&f.status==='loaded'),
        header:rect(document.querySelector('.top-bar')),logo:rect(document.querySelector('.sidebar-logo')),
        modal:overlay.classList.contains('hidden')?null:rect(document.querySelector('[data-modal]')),
        controls:[...document.querySelectorAll('.employees-page button,.employee-form-modal button,.employee-detail-modal button,.employee-actions button,.expense-form-modal button')].filter(visible).map(rect),
        pairs:[...document.querySelectorAll('.detail-fields>div')].filter(visible).map(n=>({label:rect(n.querySelector('dt')),value:rect(n.querySelector('dd'))})),
        employeeOptions:[...document.querySelectorAll('[name="employeeId"] option')].map(n=>({id:n.value,text:n.text,selected:n.selected})),
        routes:[...document.querySelectorAll('[data-nav-route]')].map(n=>n.dataset.navRoute),
        text:document.querySelector('[data-route-outlet]').innerText,detailText:document.querySelector('[data-modal-body]').innerText
      };
    })()`);
    await check(label,()=>{
      assert.ok(metrics.fontLoaded);assert.ok(metrics.scrollWidth<=width,'Viewport overflow');assert.equal(metrics.header.bottom,metrics.logo.bottom);assert.equal(metrics.routes.length,28);
      if(metrics.modal){assert.ok(metrics.modal.x>=0&&metrics.modal.y>=0&&metrics.modal.right<=width&&metrics.modal.bottom<=height+1,'Modal outside viewport');}
      for(const r of metrics.controls)assert.ok(r.height>=44,'Small Employee action');
      for(const p of metrics.pairs)assert.ok(p.value.x>=p.label.right+7||p.value.y>=p.label.bottom,'Detail overlap');
      if(page==='employee-list'){assert.match(metrics.text,/Nguyễn An/);assert.match(metrics.text,/Trần Bình/);assert.doesNotMatch(metrics.text,/Lê Chi/);}
      if(page==='employee-detail')assert.match(metrics.detailText,/Đã nghỉ/);
      if(page==='employee-archived')assert.match(metrics.detailText,/Đã lưu trữ/);
      if(page==='expense-create'){assert.deepEqual(metrics.employeeOptions.map(o=>o.id),['','1']);}
      if(page==='expense-edit'){assert.ok(metrics.employeeOptions.some(o=>o.id==='2'&&o.selected&&o.text.includes('Đã nghỉ')));assert.ok(!metrics.employeeOptions.some(o=>o.id==='3'));}
      if(page==='expense-archived')assert.ok(metrics.employeeOptions.some(o=>o.id==='3'&&o.selected&&o.text.includes('Đã lưu trữ')));
      assert.doesNotMatch(metrics.text+metrics.detailText,/Người dùng đã xóa|employee_user_id/);
    });
    const layout=await cdp('Page.getLayoutMetrics');
    const clip={x:0,y:0,width,height:metrics.modal?height:Math.min(layout.cssContentSize.height,2600),scale:1};
    const shot=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip});
    await writeFile(join(out,`${label}.png`),Buffer.from(shot.data,'base64'));
    results.push({label,pass:!errors.some(e=>e.name===label),...metrics,text:undefined,detailText:undefined});
    console.log(`${label}: ${results.at(-1).pass?'PASS':'FAIL'}`);
    if(theme==='light')await check(`${label} interaction`,async()=>{
      const waitFor=async expression=>{for(let n=0;n<80;n++){if(await evaluate(expression))return;await pause(40);}throw Error('Interaction timeout: '+expression);};
      const submit=async(id,values={})=>evaluate(`(()=>{
        const form=document.getElementById(${JSON.stringify(id)});
        for(const [key,value] of Object.entries(${JSON.stringify(values)}))form.elements[key].value=value;
        const button=form.querySelector('[type="submit"]');button.scrollIntoView({block:'nearest'});
        const control=button.getBoundingClientRect(),body=document.querySelector('[data-modal-body]').getBoundingClientRect();
        if(control.top<body.top||control.bottom>body.bottom+1)throw Error('Submit action is not reachable inside the scrolling modal');
        button.click();
      })()`);
      if(page==='employee-create'||page==='employee-edit'){
        await submit('employee-form',{fullName:'Nhân viên kiểm thử mới'});
        await waitFor(`document.querySelector('[data-modal-overlay]').classList.contains('hidden')&&document.getElementById('employee-table-body').innerText.includes('Nhân viên kiểm thử mới')`);
      }
      if(page==='employee-detail'||page==='employee-archived'){
        await evaluate(`document.querySelector('[data-modal-body] [data-employee-action]').click();document.querySelector('[data-employee-confirm]').click()`);
        await waitFor(`document.querySelector('[data-modal-overlay]').classList.contains('hidden')`);
      }
      if(page==='expense-create'){
        await submit('expense-form',{amount:'200000',employeeId:'1'});
        await waitFor(`document.querySelector('[data-modal-overlay]').classList.contains('hidden')&&document.getElementById('expense-table-body').innerText.includes('Nguyễn An')`);
      }
      if(page==='expense-edit'||page==='expense-archived'){
        await submit('expense-form');
        await waitFor(`document.querySelector('[data-modal-overlay]').classList.contains('hidden')`);
        const saved=await evaluate(`qaCalls.filter(c=>c.name==='save_employee_expense').at(-1)`);
        assert.equal(String(saved.args.p_employee_id),page==='expense-edit'?'2':'3');
      }
      if(page==='expense-filters'){
        await evaluate(`(()=>{const s=document.getElementById('expense-employee-filter');s.value='3';s.dispatchEvent(new Event('change'));})()`);
        await waitFor(`document.querySelectorAll('#expense-table-body tr').length===1&&document.getElementById('expense-table-body').innerText.includes('Lê Chi')`);
        assert.match(await evaluate(`document.getElementById('expense-summary').innerText`),/250.000/);
      }
      if(page==='employee-list'){
        await evaluate(`fetch('/qa/revoke')`);
        const denied=await evaluate(`(async()=>{const {EmployeeService}=await import('/src/services/EmployeeService.js');try{await EmployeeService.list();return false;}catch(e){return e.code==='42501';}})()`);assert.ok(denied);
        await evaluate(`qaAccess.permissions=[];location.hash='#/expenses?tab=employees&access=revoked'`);
        await waitFor(`document.querySelector('[data-route-outlet]').innerText.includes('Không có quyền truy cập')`);
      }
    });
  }
  await writeFile(join(out,'visual-results.json'),JSON.stringify({fixture:'Real application router/layout/pages/handlers/services; local Postgres with new migration and synthetic identity; no Production writes',results,errors},null,2));
  console.log(JSON.stringify({screenshots:results.length,errors},null,2));if(errors.length)process.exitCode=1;
} finally {
  if(ws?.readyState===1){try{await cdp('Browser.close',{},null);}catch{}ws.close();}
  chrome.kill('SIGTERM');server.close();await db.close();
}
