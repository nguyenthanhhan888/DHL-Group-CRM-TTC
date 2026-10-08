const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const navigation = read('src/constants/navigation.js');
const layout = read('src/layouts/AppLayout.js');
const app = read('src/app.js');
const css = read('src/styles/app.css');

test('Dashboard remains standalone and CRM is expanded while secondary groups use disclosures', () => {
  assert.match(navigation, /label: 'TỔNG QUAN',[\s\S]*?standalone: true,[\s\S]*?route: 'dashboard'/);
  assert.match(layout, /section\.standalone[\s\S]*nav-section-standalone/);
  assert.match(layout, /<div class="nav-section"[\s\S]*nav-section-label/);
  assert.match(layout, /section\.collapsible[\s\S]*nav-section-collapsible/);
  assert.equal((navigation.match(/collapsible: true/g) || []).length, 1);
});

test('TTC navigation is absent and unified users remains in system settings', async () => {
  const { NAV_SECTIONS } = await import(pathToFileURL(path.join(root, 'src/constants/navigation.js')).href);
  const { AppLayout } = await import(pathToFileURL(path.join(root, 'src/layouts/AppLayout.js')).href);
  const markup = AppLayout({ navSections: NAV_SECTIONS, user: { is_system_admin: true, username: 'admin' } });
  assert.doesNotMatch(markup, /ttc|Ví xu|TƯƠNG TÁC CHÉO/i);
  assert.match(markup, /#\/user-management/);
});

test('sidebar sections need no expand state while current route stays active', () => {
  assert.doesNotMatch(app, /collapsibleNavSections|collapsibleSections|activeSection/);
  assert.match(app, /link\.classList\.toggle\('active', active\)/);
  assert.match(app, /link\.setAttribute\('aria-current', 'page'\)/);
});

test('sidebar uses the valid brand asset and compact accessible presentation', () => {
  assert.match(layout, /getThemeLogoPath\(\)/);
  assert.match(layout, /data-theme-logo/);
  assert.doesNotMatch(layout, /photo_2026-08-03_06-31-15\.jpg/);
  assert.match(layout, /Diễn Châu - À Đây Rồi/);
  assert.match(css, /\.nav-section-label\{min-height:25px/);
  assert.doesNotMatch(css, /\.nav-section-items\{display:grid;grid-template-rows:0fr/);
  assert.match(css, /\.nav-section-collapsible\[open\]/);
  assert.match(css, /\.nav-item\.active\{position:relative\}/);
  assert.match(css, /\.nav-item\.active::before/);
  assert.match(css, /@media\(max-width:900px\)[\s\S]*\.sidebar\{width:min\(280px/);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)/);
});

test('sidebar uses the unified direct-permission resolution', () => {
  assert.match(app, /return canAccessRoute\(profile, normalizeRouteForPermission\(route\)\)/);
  assert.match(app, /if \(item\.permission\) return canAccessPermission\(profile, item\.permission\)/);
  assert.match(app, /return item\.route && canAccess\(item\.route\)/);
});
