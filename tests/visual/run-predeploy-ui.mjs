// Run: node tests/visual/run-predeploy-ui.mjs
// Local, isolated Chrome profile + allowlisted static server. Never contacts the DB.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { resolve, extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const out = join(root, 'docs/qa/predeploy-ui');
await mkdir(out, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), 'dhl-ui-qa-'));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
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
  throw new Error('QA fixture did not render');
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
  const pages = ['shell', 'account', 'ttc', 'system', 'promotion-create', 'promotion-detail', 'reports', 'reports-integrity', 'logs', 'log-detail'];
  for (const theme of ['light', 'dark']) {
    for (const width of theme === 'light' ? [1440, 1280, 768, 390] : [1280, 390]) {
      for (const page of pages) {
        const label = `${page}-${width}-${theme}`;
        await cdp('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width === 390 });
        await cdp('Page.navigate', { url: `http://127.0.0.1:${port}/tests/visual/predeploy-ui.html?page=${page}&theme=${theme}` });
        await ready(); await evaluate('document.fonts.ready'); await pause(400);
        const metrics = await evaluate(`(() => {
          const rect = node => { const r=node.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}; };
          const visible = node => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden';
          return {width:innerWidth,scrollWidth:document.documentElement.scrollWidth,
            fontLoaded:[...document.fonts].some(font=>font.family.includes('Be Vietnam Pro')&&font.status==='loaded'),
            header:rect(document.querySelector('.top-bar')),logo:rect(document.querySelector('.sidebar-logo')),
            sidebar:rect(document.querySelector('.sidebar')),
            overviewTables:[...document.querySelectorAll('.report-overview-grid .report-table-wrap')].map(node=>({width:node.clientWidth,scrollWidth:node.scrollWidth})),
            groups:[...document.querySelectorAll('[data-nav-group]')].map(node=>({open:node.open,expanded:node.querySelector('summary').getAttribute('aria-expanded')})),
            chevrons:[...document.querySelectorAll('.nav-section-collapsible .nav-chevron svg')].map(node=>({width:node.getBoundingClientRect().width,stroke:getComputedStyle(node).stroke})),
            routes:[...document.querySelectorAll('[data-nav-route]')].map(node=>node.dataset.navRoute),
            filters:[...document.querySelectorAll('.admin-filter-bar > .admin-filter-row input,.admin-filter-bar > .admin-filter-row select,.admin-filter-bar > .admin-filter-row button')].map(rect),
            pairs:[...document.querySelectorAll('.detail-fields>div,.log-event-meta>div')].filter(visible).map(node=>({label:rect(node.querySelector('dt')),value:rect(node.querySelector('dd'))})),
            modal:document.querySelector('[data-modal-overlay]').classList.contains('hidden')?null:rect(document.querySelector('[data-modal]')),
            dates:[...document.querySelectorAll('input[type="datetime-local"]')].map(node=>({value:node.value,...rect(node)})),
            text:document.querySelector('[data-route-outlet]').innerText,
            detailText:document.querySelector('[data-modal-body]').innerText,
            accountText:document.querySelector('.sidebar-account-dropdown').innerText,
            controls:[...document.querySelectorAll('.sidebar-account-dropdown a,.sidebar-account-dropdown button')].filter(visible).map(rect)
          };
        })()`);
        await check(label, () => {
          assert.equal(metrics.width, width); assert.ok(metrics.fontLoaded, 'Application font missing');
          assert.ok(metrics.scrollWidth <= width, `Horizontal overflow: ${metrics.scrollWidth}`);
          assert.equal(metrics.header.bottom, metrics.logo.bottom, 'Topbar and Sidebar borders do not align');
          if (['shell','account','ttc','system'].includes(page)) assert.equal(metrics.sidebar.x,0,'Open Sidebar clipped or animation not settled');
          for (const table of metrics.overviewTables) assert.ok(table.scrollWidth<=table.width,'Overview content clipped');
          assert.ok(metrics.routes.includes('ttc') && metrics.routes.includes('admin/ttc'), 'Missing TTC destination');
          assert.equal(metrics.routes.length, 28, 'Route lost');
          for(const arrow of metrics.chevrons) assert.ok(arrow.width >= 16 && arrow.stroke !== 'none', 'Disclosure arrow invisible');
          if (width >= 1280 && metrics.filters.length) assert.ok(metrics.filters.every(r=>Math.abs(r.y-metrics.filters[0].y)<2), 'Basic filters wrap');
          for(const pair of metrics.pairs) assert.ok(pair.value.x >= pair.label.right+7 || pair.value.y >= pair.label.bottom, 'Label/value overlap');
          if (metrics.modal) assert.ok(metrics.modal.right<=width && metrics.modal.x>=0,'Modal outside viewport');
          if (page==='shell') assert.deepEqual(metrics.groups.map(g=>g.open), [false,false]);
          if (page==='ttc') assert.equal(metrics.groups[0].open,true);
          if (page==='system') assert.equal(metrics.groups[1].open,true);
          if (page==='account') { assert.match(metrics.accountText,/Hồ sơ[\s\S]*Đăng xuất/); for(const r of metrics.controls) assert.ok(r.height>=44); }
          if(page==='promotion-create') { assert.equal(metrics.dates.length,2); assert.ok(metrics.dates.every(r=>/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(r.value))); assert.equal(metrics.dates[0].value,metrics.dates[1].value); }
          if(page==='promotion-detail') { assert.equal(metrics.pairs.length,6); assert.match(metrics.detailText,/2\.400\.000 VNĐ/); }
          if(page==='reports-integrity') { assert.match(metrics.text,/Thanh toán #343 cần kiểm tra/); assert.match(metrics.text,/Lan Lan/);assert.match(metrics.text,/Ngọc Anh/);assert.match(metrics.text,/Không xác định/);assert.doesNotMatch(metrics.text,/Không tên|entityType|reference ID/); }
          if(page==='logs') { assert.match(metrics.text,/Thanh toán #348 của Lan Lan cần kiểm tra/);assert.match(metrics.text,/Ngọc Anh · 150\.000 VNĐ · Chuyển khoản/);assert.doesNotMatch(metrics.text,/intent|transfer|AMOUNT_MISMATCH/); }
          if(page==='log-detail') { assert.equal(metrics.pairs.length,12);assert.match(metrics.detailText,/Lan Lan[\s\S]*Ngọc Anh/);assert.doesNotMatch(metrics.detailText,/intent|event_key|transfer/); }
        });
        let clip={x:0,y:0,width,height:1000,scale:1};
        if(['reports','reports-integrity','logs'].includes(page)) { const layout=await cdp('Page.getLayoutMetrics');clip.height=Math.min(layout.cssContentSize.height,2600); }
        const shot=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip});
        await writeFile(join(out,`${label}.png`),Buffer.from(shot.data,'base64'));
        results.push({label,pass:!errors.some(error=>error.name===label),...metrics,text:undefined,detailText:undefined,accountText:undefined});
        console.log(`${label}: ${results.at(-1).pass?'PASS':'FAIL'}`);
        if(theme==='light') await check(`${label} interactions`, async () => {
          if(page==='shell') {
            await evaluate(`qaNavigate('admin/ttc')`); assert.equal(await evaluate(`document.querySelectorAll('[data-nav-group]')[0].open`),true);
            await evaluate(`qaNavigate('logs')`); assert.equal(await evaluate(`document.querySelectorAll('[data-nav-group]')[1].open`),true);
            await evaluate(`qaNavigate('promotions')`); assert.deepEqual(await evaluate(`[...document.querySelectorAll('[data-nav-group]')].map(g=>g.open)`),[false,false]);
            if(width<=900){ await evaluate(`document.querySelector('[data-sidebar-overlay]').click()`);assert.equal(await evaluate(`document.querySelector('[data-sidebar]').classList.contains('open')`),false); }
          }
          if(page==='account') {
            await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))`);
            assert.equal(await evaluate(`document.querySelector('[data-sidebar-account]').open`),false);
            await evaluate(`document.querySelector('[data-sidebar-account] summary').click();document.querySelector('.sidebar-account-dropdown [data-logout]').click()`);
            assert.equal(await evaluate('qaCalls.logout'),1); assert.equal(await evaluate(`document.querySelector('[data-sidebar-account]').open`),false);
          }
          if(page==='promotion-create') {
            await evaluate(`(()=>{const f=document.getElementById('promotion-form');f.querySelector('[name="code"]').value='QA';f.querySelector('[name="name"]').value='QA local';f.querySelector('[name="discount_value"]').value='3';f.querySelector('[name="starts_at"]').value='';f.querySelector('[name="ends_at"]').value='';f.requestSubmit();})()`);await pause(50);
            const saved=await evaluate('qaCalls.saved.at(-1)');assert.equal(saved.starts_at,'');assert.equal(saved.ends_at,'');
            await evaluate(`document.querySelector('[data-promotion-action="edit"]').click()`);await pause(50);
            assert.deepEqual(await evaluate(`[...document.querySelectorAll('input[type="datetime-local"]')].map(i=>i.value)`),['','']);
          }
          if(page==='reports') {
            assert.equal(await evaluate(`document.getElementById('report-advanced-filters').hidden`),true);
            await evaluate(`document.getElementById('report-advanced-toggle').click()`);
            assert.equal(await evaluate(`document.getElementById('report-advanced-filters').hidden`),false);
            const controls=await evaluate(`[...document.querySelectorAll('#report-advanced-filters input,#report-advanced-filters select')].map(n=>({width:n.getBoundingClientRect().width,right:n.getBoundingClientRect().right}))`);
            assert.equal(controls.length,9);for(const c of controls)assert.ok(c.width>100&&c.right<=width);
            await evaluate(`document.getElementById('report-payment-status-filter').value='cancelled';document.getElementById('report-payment-status-filter').dispatchEvent(new Event('change'));`);await pause(50);
            assert.equal(await evaluate('qaCalls.reports.at(-1).filters.paymentStatus'),'cancelled');
            await evaluate(`document.getElementById('report-refresh-button').click()`);await pause(50);assert.equal(await evaluate('qaCalls.reports.at(-1).filters.paymentStatus'),'cancelled');
          }
          if(page==='reports-integrity') {
            await evaluate(`document.getElementById('report-search').value='Lan Lan';document.getElementById('report-search').dispatchEvent(new Event('input'))`);
            assert.equal(await evaluate(`document.querySelectorAll('.integrity-card').length`),2);
          }
        });
      }
    }
  }
  await writeFile(join(out,'results.json'),JSON.stringify({fixture:'Real application renderers, CSS and handlers; deterministic local service data, no Production access',results,errors},null,2));
  console.log(JSON.stringify({screenshots:results.length,errors},null,2));
  if(errors.length)process.exitCode=1;
} finally {
  if(ws?.readyState===1){try{await cdp('Browser.close',{},null);}catch{}ws.close();}
  chrome.kill('SIGTERM');server.close();
}
