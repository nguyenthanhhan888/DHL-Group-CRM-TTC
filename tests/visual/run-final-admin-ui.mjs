// Run: node tests/visual/run-final-admin-ui.mjs
// Local, isolated Chrome profile + allowlisted static server. Never contacts the DB.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { resolve, extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const out = join(root, 'docs/qa/final-admin-ui');
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
  for (const theme of ['light', 'dark']) {
    for (const width of theme === 'light' ? [1440, 1280, 768, 390] : [1280, 390]) {
      for (const page of ['expenses', 'logs', 'detail', 'promotions', 'footer']) {
        const label = `${page}-${width}-${theme}`;
        await cdp('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width === 390 });
        await cdp('Page.navigate', { url: `http://127.0.0.1:${port}/tests/visual/final-admin-ui.html?page=${page}&theme=${theme}` });
        await ready();
        await evaluate('document.fonts.ready');
        const metrics = await evaluate(`(() => {
          const rect = node => { const r = node.getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height, right:r.right, bottom:r.bottom }; };
          const filters = [...document.querySelectorAll('.admin-filter-bar > .admin-filter-row input, .admin-filter-bar > .admin-filter-row select, .admin-filter-bar > .admin-filter-row button')].map(node => ({id:node.id, ...rect(node)}));
          const pairs = [...document.querySelectorAll('.log-event-meta > div')].map(node => ({label:rect(node.querySelector('dt')), value:rect(node.querySelector('dd'))}));
          return { width:innerWidth, scrollWidth:document.documentElement.scrollWidth, filters, pairs, filterHeight:document.querySelector('.admin-filter-bar')?.getBoundingClientRect().height,
            fontLoaded:[...document.fonts].some(font => font.family.includes('Be Vietnam Pro') && font.status === 'loaded'),
            tables:[...document.querySelectorAll('.expense-table, .logs-table, .promotions-table')].filter(node=>node.offsetWidth).map(node=>({width:node.getBoundingClientRect().width, container:node.parentElement.getBoundingClientRect().width})),
            clippedCellText:[...document.querySelectorAll('.expense-table td, .logs-table td, .promotions-table td')].filter(cell=>cell.offsetWidth).flatMap(cell=>{
              const bounds=cell.getBoundingClientRect();
              const walker=document.createTreeWalker(cell,NodeFilter.SHOW_TEXT); const failures=[];
              while(walker.nextNode()) { if(!walker.currentNode.textContent.trim()) continue; const range=document.createRange();range.selectNodeContents(walker.currentNode);
                for(const r of range.getClientRects()) if(r.right>bounds.right+1) failures.push({text:walker.currentNode.textContent,right:r.right,cellRight:bounds.right}); }
              return failures;
            }),
            functionalIcons:[...document.querySelectorAll('.portal-footer-action-icon svg, .portal-channel-row > svg')].map(node=>({stroke:getComputedStyle(node).stroke, fill:getComputedStyle(node).fill})),
            modal:document.querySelector('.log-detail-modal') ? rect(document.querySelector('.log-detail-modal')) : null,
            footerColumns: [...document.querySelectorAll('.portal-footer-grid > div')].map(rect),
            icons: [...document.querySelectorAll('.portal-channel-icon')].map(node=>({complete:node.complete, naturalWidth:node.naturalWidth,...rect(node)})),
            links: [...document.querySelectorAll('[data-public-official-channels] a')].map(node=>node.href),
            text: document.querySelector('[data-route-outlet]')?.innerText || '' };
        })()`);
        await check(label, () => {
          assert.equal(metrics.width, width);
          assert.ok(metrics.fontLoaded, 'Application font did not load');
          assert.ok(metrics.scrollWidth <= width, `Page overflow: ${metrics.scrollWidth} > ${width}`);
          for (const table of metrics.tables) assert.ok(table.width <= table.container + 1, 'Table actions clipped by horizontal scrolling');
          assert.deepEqual(metrics.clippedCellText, [], 'Table text extends into another cell');
          if (width >= 1280 && metrics.filters.length) {
            assert.ok(metrics.filters.every(rect => Math.abs(rect.y - metrics.filters[0].y) < 2), 'Basic filters wrap on desktop');
            assert.ok(metrics.filterHeight < 110, `Filter panel too tall: ${metrics.filterHeight}`);
          }
          for (const control of metrics.filters) { assert.ok(control.height >= 43, `Small touch target: ${control.id}`); assert.ok(control.right <= width, `Control overflows: ${control.id}`); }
          if (page === 'detail') {
            assert.equal(metrics.pairs.length, 4);
            for (const pair of metrics.pairs) assert.ok(width <= 680 ? pair.value.y >= pair.label.bottom : pair.value.x >= pair.label.right + 8, 'Metadata labels and values overlap');
          }
          if (page === 'footer') {
            assert.equal(metrics.functionalIcons.length, 4);
            for (const icon of metrics.functionalIcons) assert.ok(icon.stroke !== 'none' && icon.fill === 'none', 'Functional icon has no visible strokes');
            assert.equal(new Set(metrics.links).size, metrics.links.length, 'Duplicate destination');
            assert.ok(metrics.icons.length >= 6);
            for (const icon of metrics.icons) assert.ok(icon.complete && icon.naturalWidth > 0 && icon.width >= 20 && icon.height >= 20, 'Brand asset missing or too small');
            if (width >= 1280) assert.ok(metrics.footerColumns.every(rect => rect.y === metrics.footerColumns[0].y), 'Footer not in 3 columns');
          }
          if (page === 'logs') { assert.match(metrics.text, /đã hủy hồ sơ đăng ký #123123/); assert.match(metrics.text, /Lý do: Sai dữ liệu/); assert.doesNotMatch(metrics.text, /· 123123|Mirrored/); }
        });
        // Full page for mobile filters/cards; footer clipped from the rendered homepage.
        let clip = { x: 0, y: 0, width, height: 1000, scale: 1 };
        if (page === 'footer') clip = await evaluate(`(() => {const r=document.querySelector('.portal-footer').getBoundingClientRect();return {x:r.x,y:r.y+scrollY,width:r.width,height:r.height,scale:1}})()`);
        else if (page !== 'detail') { const layout = await cdp('Page.getLayoutMetrics'); clip = { x: 0, y: 0, width, height: Math.min(layout.cssContentSize.height, 2600), scale: 1 }; }
        const shot = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, ...(clip ? { clip } : {}) });
        await writeFile(join(out, `${label}.png`), Buffer.from(shot.data, 'base64'));
        results.push({ label, pass: !errors.some(error => error.name === label), ...metrics, text: undefined });
        console.log(`${label}: ${results.at(-1).pass ? 'PASS' : 'FAIL'}`);
        if (theme === 'light' && width === 1280) {
          await check(`${page} interactions`, async () => {
            if (page === 'promotions') {
              await evaluate(`document.getElementById('promotion-search').value='dang ky moi';document.getElementById('promotion-search').dispatchEvent(new Event('input'));`);
              assert.equal(await evaluate(`document.querySelectorAll('#promotions-body tr').length`), 1);
              assert.match(await evaluate(`document.getElementById('promotions-body').innerText`), /TRIAN2026/);
              await evaluate(`document.getElementById('promotion-status-filter').value='Hết hạn';document.getElementById('promotion-status-filter').dispatchEvent(new Event('change'));`);
              assert.match(await evaluate(`document.getElementById('promotions-body').innerText`), /Không tìm thấy/);
              await evaluate(`document.getElementById('promotion-filter-reset').click()`);
              assert.equal(await evaluate(`document.querySelectorAll('#promotions-body tr').length`), 4);
              await evaluate(`document.querySelector('[data-promotion-menu-trigger]').click()`);
              assert.equal(await evaluate(`document.querySelector('[data-promotion-menu-trigger]').getAttribute('aria-expanded')`), 'true');
            }
            if (page === 'expenses') {
              await evaluate(`document.getElementById('expense-category-filter').value='advertising';document.getElementById('expense-category-filter').dispatchEvent(new Event('change'));`);
              await pause(50);
              assert.equal(await evaluate(`document.querySelectorAll('#expense-table-body tr').length`), 1);
              assert.equal(await evaluate(`window.qaCalls.expenses.at(-1).category`), 'advertising');
              await evaluate(`document.getElementById('expense-filter-reset').click()`); await pause(50);
              assert.equal(await evaluate(`document.querySelectorAll('#expense-table-body tr').length`), 3);
              await evaluate(`document.getElementById('expense-category-button').click()`);
              assert.ok(await evaluate(`[...document.querySelectorAll('.expense-category-row input')].some(input => input.value === 'Quảng cáo')`));
              await evaluate(`document.querySelector('[data-modal-close]').click()`);
            }
            if (page === 'logs') {
              assert.equal(await evaluate(`document.getElementById('log-advanced-filters').hidden`), true);
              await evaluate(`document.getElementById('log-advanced-toggle').click()`);
              assert.equal(await evaluate(`document.getElementById('log-advanced-filters').hidden`), false);
              const advancedShot = await cdp('Page.captureScreenshot', { format: 'png' });
              await writeFile(join(out, 'logs-advanced-1280.png'), Buffer.from(advancedShot.data, 'base64'));
              await evaluate(`document.getElementById('log-action-filter').value='cancel';document.getElementById('log-action-filter').dispatchEvent(new Event('change'));`); await pause(50);
              assert.equal(await evaluate(`window.qaCalls.logs.at(-1).activity`), 'cancel');
              assert.equal(await evaluate(`document.querySelectorAll('#logs-table-body tr').length`), 2);
              await evaluate(`document.getElementById('log-show-technical').click()`); await pause(50);
              assert.equal(await evaluate(`window.qaCalls.technical.at(-1).showTechnical`), true);
            }
            if (page === 'detail') {
              await evaluate(`document.querySelector('[data-modal-close]').click()`);
              assert.equal(await evaluate(`document.querySelector('[data-modal-overlay]').classList.contains('hidden')`), true);
            }
          });
        }
      }
    }
  }
  await writeFile(join(out, 'results.json'), JSON.stringify({ fixture: 'Real page/layout/CSS renderers with deterministic service responses; no production data access', results, errors }, null, 2));
  console.log(JSON.stringify({ screenshots: results.length, errors }, null, 2));
  if (errors.length) process.exitCode = 1;
} finally {
  if (ws?.readyState === 1) { try { await cdp('Browser.close', {}, null); } catch {} ws.close(); }
  chrome.kill('SIGTERM'); server.close();
}
