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

const ttcAdminItems = [
  ['admin/ttc', 'Tổng quan TTC'],
  ['admin-ttc-announcements', 'Thông báo'],
  ['admin-ttc-campaigns', 'Tăng tương tác'],
  ['admin-ttc-tasks', 'Duyệt nhiệm vụ'],
  ['admin-ttc-wallets', 'Ví xu'],
  ['admin-ttc-settings', 'Cấu hình giá'],
  ['admin-ttc-logs', 'Kiểm tra & vi phạm'],
];

test('Dashboard remains standalone outside every accordion', () => {
  assert.match(navigation, /label: 'TỔNG QUAN',[\s\S]*?standalone: true,[\s\S]*?route: 'dashboard'/);
  assert.match(layout, /section\.standalone[\s\S]*nav-section-standalone/);
  assert.match(layout, /section\.collapsible[\s\S]*<details class="nav-section nav-section-collapsible"/);
});

test('TTC keeps its operational items while unified users moves to system settings', async () => {
  const section = navigation.match(/label: 'TƯƠNG TÁC CHÉO',[\s\S]*?\n  \},\n  \{\n    label: 'CÀI ĐẶT HỆ THỐNG'/)?.[0] || '';
  const { NAV_SECTIONS } = await import(pathToFileURL(path.join(root, 'src/constants/navigation.js')).href);
  const { AppLayout } = await import(pathToFileURL(path.join(root, 'src/layouts/AppLayout.js')).href);
  const markup = AppLayout({ navSections: NAV_SECTIONS, user: { is_system_admin: true, username: 'admin' } });
  for (const [route, label] of ttcAdminItems) {
    const escapedRoute = route.replace('/', '\\/');
    const renderedLabel = label.replace('&', '&amp;');
    assert.match(section, new RegExp(`route: '${escapedRoute}'[\\s\\S]*?label: '${label}'`));
    assert.match(markup, new RegExp(`href="#/${escapedRoute}"[^>]*>[\\s\\S]*?${renderedLabel}`));
  }
  assert.doesNotMatch(section, /admin-ttc-users/);
  assert.match(navigation, /label: 'CÀI ĐẶT HỆ THỐNG',[\s\S]*?route: 'user-management', label: 'Quản lý người dùng'/);
  assert.doesNotMatch(navigation.match(/label: 'CÀI ĐẶT HỆ THỐNG',[\s\S]*/)?.[0] || '', /route: 'admin-ttc-settings'/);
});

test('accordion keeps one section open and current route controls the active section', () => {
  assert.match(app, /if \(otherSection !== section\) otherSection\.open = false/);
  assert.match(app, /const activeSection = collapsibleSections\.find/);
  assert.match(app, /section\.open = section === activeSection/);
  assert.match(layout, /aria-expanded="false"/);
  assert.match(app, /setAttribute\('aria-expanded', String\(section\.open\)\)/);
});

test('sidebar uses the valid brand asset and compact accessible presentation', () => {
  assert.match(layout, /getThemeLogoPath\(\)/);
  assert.match(layout, /data-theme-logo/);
  assert.doesNotMatch(layout, /photo_2026-08-03_06-31-15\.jpg/);
  assert.match(layout, /Diễn Châu - À Đây Rồi/);
  assert.match(css, /\.nav-section-items\{display:grid;grid-template-rows:0fr/);
  assert.match(css, /transition:grid-template-rows \.18s ease/);
  assert.match(css, /\.nav-section-toggle:focus-visible/);
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
