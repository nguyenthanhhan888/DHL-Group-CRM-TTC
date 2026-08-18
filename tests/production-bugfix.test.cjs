const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

const root = path.join(__dirname, '..');
const { createPaymentExpiredAt, PAYOS_PAYMENT_TTL_SECONDS } = require('../api/payos/_utils');

test('admin renewal migration uses type-safe inclusive calendar arithmetic', async () => {
  const sql = await readFile(path.join(root, 'supabase/migrations/20260811183000_fix_admin_manual_renewal_date_arithmetic.sql'), 'utf8');
  assert.match(sql, /make_interval\(months => months_input\) - interval '1 day'/);
  assert.doesNotMatch(sql, /make_interval\(months => months_input\) - 1\s*\)/);
  const start = new Date('2026-08-11T00:00:00Z');
  const expected = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 6, start.getUTCDate()) - 86400000);
  assert.equal(expected.toISOString().slice(0, 10), '2027-02-10');
});

test('PayOS creation paths send a 15-minute expiredAt independent of renewal token TTL', async () => {
  assert.equal(PAYOS_PAYMENT_TTL_SECONDS, 900);
  assert.equal(createPaymentExpiredAt(1_000_000), 1900);
  const publicRenewal = await readFile(path.join(root, 'api/public/renew-kiosk.js'), 'utf8');
  const registration = await readFile(path.join(root, 'api/payos/create-registration-payment.js'), 'utf8');
  const general = await readFile(path.join(root, 'api/payos/create-payment.js'), 'utf8');
  for (const source of [publicRenewal, registration, general]) assert.match(source, /expiredAt: createPaymentExpiredAt\(\)/);
  assert.match(publicRenewal, /expiresAt: request\.expiredAt/);
});

test('public renewal return polling is bounded and offers retry for terminal orders', async () => {
  const source = await readFile(path.join(root, 'src/pages/LookupPage.js'), 'utf8');
  assert.match(source, /attempt < 10/);
  assert.match(source, /setTimeout\(resolve, 3000\)/);
  assert.match(source, /cancelled.*expired.*failed/);
  assert.match(source, /data-renew-retry/);
});

test('semantic theme roles cover notices and Customer Detail headings', async () => {
  const css = await readFile(path.join(root, 'src/styles/app.css'), 'utf8');
  for (const token of ['--bg-soft', '--info-bg', '--info-border', '--info-text']) assert.match(css, new RegExp(token));
  assert.match(css, /\.legacy-scope-notice[^}]*color:var\(--info-text\)/s);
  assert.match(css, /\.dash-card-header h3,\.admin-card h3,\.detail-section h3 \{ color:var\(--text-primary\)/);
});

test('theme preference is shared and applied before the stylesheet loads', async () => {
  const app = await readFile(path.join(root, 'src/app.js'), 'utf8');
  const publicLayout = await readFile(path.join(root, 'src/components/PublicLayout.js'), 'utf8');
  const html = await readFile(path.join(root, 'index.html'), 'utf8');
  assert.match(app, /THEME_STORAGE_KEY = 'dhlThemePreference'/);
  assert.match(publicLayout, /localStorage\.setItem\('dhlThemePreference'/);
  assert.ok(html.indexOf("localStorage.getItem('dhlThemePreference')") < html.indexOf('app.css'));
});
