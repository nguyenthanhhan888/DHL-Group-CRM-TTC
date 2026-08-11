import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PublicHomePage, PublicLayout } from '../src/components/OfficialCommunityCard.js';

test('public layout includes all public routes, official channels and exact contacts', () => {
  const html = PublicLayout({ route: 'home', content: PublicHomePage() });
  for (const value of [
    '#/home', '#/register', '#/legacy-registration', '#/tra-cuu-kiosk', '#/login',
    'https://www.facebook.com/groups/1145443782801316',
    'https://www.facebook.com/groups/dienchaugroup888',
    'https://www.facebook.com/groups/320237372898775',
    'https://www.facebook.com/admin.dc.adayroi/',
    '0888690346', '0888640346', '0333 015 337',
  ]) assert.match(html, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(html, /data-public-menu-button/);
  assert.match(html, /data-public-menu-scrim/);
  assert.match(html, /public-drawer-brand/);
  assert.match(html, /aria-current="page"/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.match(html, /Diễn Châu - À Đây Rồi<\/span><span class="public-brand-separator">/);
  assert.match(html, /Cổng đăng ký, bổ sung và tra cứu Kiosk chính thức của cộng đồng\./);
  assert.doesNotMatch(html, /Kết nối Kiosk cùng cộng đồng/);
});

test('public app recognizes Home and all public functional routes', async () => {
  const source = await fs.readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(source, /new Set\(\['home', 'register', 'legacy-registration', 'tra-cuu-kiosk'\]\)/);
  assert.match(source, /getRouteName\(\) \|\| 'home'/);
});

test('every relative JavaScript import reachable from app.js exists on disk', async () => {
  const entry = path.resolve('src/app.js');
  const visited = new Set();
  const missing = [];

  async function inspect(file) {
    if (visited.has(file)) return;
    visited.add(file);
    const source = await fs.readFile(file, 'utf8');
    const imports = source.matchAll(/(?:import|export)\s+(?:[^'\"]+?\s+from\s+)?['\"]([^'\"]+)['\"]/g);
    for (const match of imports) {
      if (!match[1].startsWith('.')) continue;
      const target = path.resolve(path.dirname(file), match[1]);
      try {
        await fs.access(target);
        await inspect(target);
      } catch {
        missing.push({ from: file, import: match[1] });
      }
    }
  }

  await inspect(entry);
  assert.deepEqual(missing, []);
  assert.ok(visited.has(path.resolve('src/components/OfficialCommunityCard.js')));
  assert.ok(visited.has(path.resolve('src/pages/RegisterPage.js')));
  assert.equal(visited.has(path.resolve('src/pages/PublicHomePage.js')), false);
  assert.equal(visited.has(path.resolve('src/components/PublicLayout.js')), false);
  assert.equal(visited.has(path.resolve('src/pages/PublicKioskLookupPage.js')), false);
});
