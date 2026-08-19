const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = (relativePath) => readFile(path.join(root, relativePath), 'utf8');

test('semantic theme tokens cover readable text, borders, notices, and statuses', async () => {
  const css = await source('src/styles/app.css');
  for (const token of [
    '--bg-page', '--bg-surface', '--bg-elevated', '--bg-soft',
    '--bg-card', '--bg-control', '--bg-hover', '--bg-header', '--bg-sidebar', '--bg-overlay',
    '--text-primary', '--text-secondary', '--text-muted', '--text-disabled',
    '--text-on-accent', '--border-default', '--border-soft', '--border-interactive',
    '--primary', '--primary-hover', '--primary-soft', '--shadow-card',
    '--info-bg', '--info-border', '--info-text', '--success-bg', '--success-text',
    '--success-border', '--warning-bg', '--warning-border', '--warning-text',
    '--danger-bg', '--danger-border', '--danger-text',
    '--table-header-bg', '--chart-grid', '--chart-label', '--chart-center', '--chart-center-text',
  ]) assert.match(css, new RegExp(token));
  assert.match(css, /html\[data-theme="light"\][\s\S]*--text-primary:\s*#0f172a/);
  assert.match(css, /html\[data-theme="light"\][\s\S]*--info-text:\s*#1e3a8a/);
});

test('theme architecture uses one token definition instead of light-only correction passes', async () => {
  const css = await source('src/styles/app.css');
  assert.equal((css.match(/html\[data-theme="light"\]/g) || []).length, 1);
  assert.doesNotMatch(css, /Final light-theme pass|late component blocks from falling back/i);
  assert.match(css, /Theme-neutral component layer/);
  assert.match(css, /\.form-control,[\s\S]*?background:var\(--bg-control\);[\s\S]*?border-color:var\(--border-default\)/);
  assert.match(css, /\.data-table thead \{ background:var\(--table-header-bg\); \}/);
  assert.match(css, /\.modal,\.toast,[\s\S]*?background:var\(--bg-elevated\)/);
  assert.equal((css.match(/!important/g) || []).length, 1);
});

test('dashboard canvas resolves semantic theme colors and redraws after theme changes', async () => {
  const [charts, app] = await Promise.all([
    source('src/components/DashboardCharts.js'),
    source('src/app.js'),
  ]);
  for (const token of ['--primary', '--chart-grid', '--chart-label', '--chart-center', '--chart-center-text']) {
    assert.match(charts, new RegExp(token));
  }
  assert.match(charts, /getComputedStyle\(document\.documentElement\)/);
  assert.match(charts, /addEventListener\('dhl:themechange'/);
  assert.match(app, /dispatchEvent\(new CustomEvent\('dhl:themechange'/);
  assert.doesNotMatch(charts, /ctx\.(?:fillStyle|strokeStyle)\s*=\s*['"](?:#|rgba?\()/);
});

test('detail headings, tabs, and information banners use semantic colors', async () => {
  const css = await source('src/styles/app.css');
  for (const selector of ['.dash-card-header h3', '.admin-card h3', '.detail-section h3']) {
    assert.ok(css.includes(selector));
  }
  assert.match(css, /Theme-neutral component layer[\s\S]*?color:var\(--text-primary\)/);
  assert.match(css, /\.admin-user-tab\s*\{[\s\S]*?color:\s*var\(--text-secondary\)/);
  assert.match(css, /\.ttc-tab-button\s*\{[\s\S]*?color:\s*var\(--text-secondary\)/);
  assert.match(css, /\.legacy-scope-notice,\s*\.legacy-payment-proof\s*\{[\s\S]*?color:\s*var\(--info-text\)/);
  assert.match(css, /\.notice strong\s*\{\s*color:\s*inherit/);
});

test('login is a two-tab official portal using the centralized cover asset', async () => {
  const [login, organization] = await Promise.all([
    source('src/pages/LoginPage.js'),
    source('src/config/organization.js'),
  ]);
  assert.equal((login.match(/data-auth-tab=/g) || []).length, 2);
  assert.match(login, /Đăng nhập/);
  assert.match(login, /Đăng ký tài khoản/);
  assert.doesNotMatch(login, /Đăng ký Kiosk/);
  assert.match(login, /PUBLIC_BRAND\.assets\.cover/);
  assert.match(organization, /cover:\s*'images\/cover\.PNG'/);
  assert.match(login, /Cổng chính thức/);
  assert.match(login, /Kết nối rõ ràng • Quản lý thuận tiện/);
  assert.doesNotMatch(login, /Tăng lượt thích|Tăng follow|Tăng share/);
});

test('mobile login places the auth form before the compact intro panel', async () => {
  const css = await source('src/styles/app.css');
  assert.match(css, /@media\s*\(max-width:\s*620px\)[\s\S]*?\.public-site \.auth-account-panel\s*\{\s*order:\s*1/);
  assert.match(css, /@media\s*\(max-width:\s*620px\)[\s\S]*?\.public-site \.auth-story-panel\s*\{\s*order:\s*2/);
});

test('public renewal uses the canonical secret and application URL settings', async () => {
  const [token, renewal] = await Promise.all([
    source('api/public/_renewal-token.js'),
    source('api/public/renew-kiosk.js'),
  ]);
  assert.match(token, /process\.env\.PUBLIC_RENEWAL_TOKEN_SECRET/);
  assert.match(renewal, /process\.env\.APP_BASE_URL\|\|process\.env\.VERCEL_URL/);
  assert.doesNotMatch(renewal, /PUBLIC_APP_URL|adayroidc\.com/);
});

test('lookup always renders renewal entry point and blocks unavailable flows before PayOS', async () => {
  const lookup = await source('src/pages/LookupPage.js');
  assert.match(lookup, /Gia hạn Kiosk/);
  assert.doesNotMatch(lookup, /item\.renewalAvailable\?`<button/);
  assert.match(lookup, /if \(!item\.renewalAvailable\).*blockedRenewalPanel/);
  assert.match(lookup, /PENDING_APPROVAL/);
  assert.match(lookup, /INVALID_PRICE/);
});

test('only dhlThemePreference is used as a theme storage key', async () => {
  const [app, layout, html] = await Promise.all([
    source('src/app.js'), source('src/components/PublicLayout.js'), source('index.html'),
  ]);
  const combined = `${app}\n${layout}\n${html}`;
  assert.match(app, /THEME_STORAGE_KEY\s*=\s*'dhlThemePreference'/);
  assert.match(layout, /localStorage\.setItem\('dhlThemePreference'/);
  assert.match(html, /localStorage\.getItem\('dhlThemePreference'/);
  assert.doesNotMatch(combined, /dhl(?:Theme|theme)(?!Preference)[A-Za-z]+/);
});
