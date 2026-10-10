import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const box = vm.createContext({
  escapeHtml: String, getUserAvatarPath: () => 'avatar.png', renderIcon: () => '',
  getThemeLogoPath: () => 'logo.png', PUBLIC_BRAND: { assets: { logoLight: 'light.png', logoDark: 'dark.png' } },
});
vm.runInContext(read('src/layouts/AppLayout.js').replace(/^import .*;\n/gm, '')
  .replace(/^export \{.*\};\n/gm, '').replaceAll('export function ', 'function '), box);

function topbar(user) {
  const html = box.AppLayout({ navSections: [], user }).match(/<header class="top-bar">([\s\S]*?)<\/header>\s*<div class="page-content"/)[1];
  assert.doesNotMatch(html, /data-supabase-badge|data-current-date|connection-badge|current-date|Hệ thống hoạt động bình thường|Không thể kết nối dữ liệu|Chưa kết nối dữ liệu/);
  assert.match(html, /class="top-bar-right top-bar-user-actions"/);
  assert.match(html, /data-theme-toggle/);
  assert.match(html, /class="top-user-menu"/);
  assert.match(html, /class="top-user-avatar"/);
  assert.match(html, /data-logout/);
  return html;
}

test('Admin topbar keeps notification, theme and account controls without status or date', () => {
  const html = topbar({ is_system_admin: true, display_name: 'Admin' });
  for (const marker of ['admin-notification-center', 'data-notification-count', 'data-notification-mark-all', 'data-notification-list', 'data-admin-change-password', 'data-admin-mfa']) {
    assert.ok(html.includes(marker), marker);
  }
  assert.match(html, /top-bar-user-actions">\s*<details class="admin-notification-center"/);
});

for (const permissions of [[], ['settings']]) {
  test(`Internal user topbar preserves allowed controls with permissions ${JSON.stringify(permissions)}`, () => {
    const html = topbar({ web_access_enabled: true, permissions });
    assert.doesNotMatch(html, /admin-notification-center|data-notification|data-admin-change-password|data-admin-mfa/);
    assert.equal(html.includes('href="#/settings"'), permissions.includes('settings'));
    assert.equal(html.includes('aria-label="Cài đặt hệ thống"'), permissions.includes('settings'));
    assert.match(html, /top-bar-user-actions">\s*<button[^>]*data-theme-toggle/);
  });
}

test('app initialization removes obsolete topbar code and retains formatDateTime', () => {
  const app = read('src/app.js');
  assert.doesNotMatch(app, /getSupabaseStatus|formatToday|data-current-date|data-supabase-badge|\bcurrentDate\b|\bsupabaseBadge\b|updateSupabaseBadge|Hệ thống hoạt động bình thường|Không thể kết nối dữ liệu/);
  assert.match(app, /import \{ formatDateTime \} from '.\/utils\/date.js'/);
  assert.match(app, /return formatDateTime\(value\)/);
  assert.match(app, /bindThemeToggle\(\)/);
});

test('topbar retains right alignment and existing action spacing', () => {
  const css = read('src/styles/app.css');
  assert.match(css, /\.top-bar\s*\{[^}]*display: flex;[^}]*justify-content: space-between;/);
  assert.match(css, /\.top-bar-right\s*\{[^}]*display: flex;[^}]*align-items: center;[^}]*gap: 16px;/);
  assert.match(css, /\.top-bar-user-actions\s*\{\s*gap: 10px;/);
});
