import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { kioskDetailHref, recentActivityPresentation } from '../src/pages/DashboardPage.js';
import { buildRecentActivity } from '../src/services/DashboardService.js';

const dashboardUrl = new URL('../src/pages/DashboardPage.js', import.meta.url);
const chartsUrl = new URL('../src/components/DashboardCharts.js', import.meta.url);
const cssUrl = new URL('../src/styles/app.css', import.meta.url);

test('recent activity maps only explicit business event types to semantic badges', () => {
  assert.deepEqual(recentActivityPresentation('Đăng ký mới'), {
    label: 'Đăng ký', tone: 'info', icon: 'store',
  });
  assert.deepEqual(recentActivityPresentation('Gia hạn'), {
    label: 'Gia hạn', tone: 'success', icon: 'refresh',
  });
  assert.deepEqual(recentActivityPresentation('Bổ sung Kiosk'), {
    label: 'Bổ sung', tone: 'secondary', icon: 'user-plus',
  });
  assert.throws(
    () => recentActivityPresentation('Thanh toán thành công'),
    /Loại hoạt động gần đây không hợp lệ/,
  );
});

test('recent activity always renders exactly one badge from the normalized presentation', async () => {
  const source = await readFile(dashboardUrl, 'utf8');
  assert.match(source, /const presentation = recentActivityPresentation\(activity\.type\)/);
  assert.match(source, /<span class="recent-activity-type is-\$\{presentation\.tone\}">\$\{presentation\.label\}<\/span>/);
  assert.doesNotMatch(source, /const badge = presentation\s*\?/);
  assert.doesNotMatch(source, /recent-activity-type">\$\{escapeHtml\(activity\.label\)\}/);
});

test('valid registration, renewal, and additional events each receive the exact business type', () => {
  const events = buildRecentActivity([
    completedPayment({ id: 1, registration_batch_id: 10, confirmed_at: '2026-08-28T10:04:00Z' }),
    completedPayment({ id: 2, payment_intent_key: 'admin-renewal:22:3:0', confirmed_at: '2026-08-28T10:03:00Z' }),
    completedPayment({ id: 3, confirmed_at: '2026-08-28T10:02:00Z' }),
    completedPayment({ id: 317, confirmed_at: '2026-08-28T10:01:00Z' }),
  ], [
    approvedRequest({ id: 30, payment_id: 3, metadata: { request_type: 'legacy' } }),
  ], [
    { record_id: '317', action: 'admin_manual_renewal' },
  ]);

  assert.deepEqual(events.map((event) => event.type), [
    'Đăng ký mới', 'Gia hạn', 'Bổ sung Kiosk', 'Gia hạn',
  ]);
  assert.equal(events.every((event) => recentActivityPresentation(event.type)), true);
});

test('registration request links classify registrations without guessing from presentation fields', () => {
  const events = buildRecentActivity([
    completedPayment({ id: 11, registration_request_id: 51 }),
    completedPayment({ id: 12 }),
  ], [
    approvedRequest({ id: 52, payment_id: 12, metadata: {} }),
  ]);
  assert.deepEqual(events.map((event) => event.type), ['Đăng ký mới', 'Đăng ký mới']);
});

test('unknown completed payment is reported explicitly instead of silently hiding its badge', () => {
  assert.throws(
    () => buildRecentActivity([completedPayment({ id: 999 })], [], []),
    /Không thể phân loại hoạt động thanh toán #999/,
  );
});

test('recent activity query selects durable event discriminators and renewal audit actions', async () => {
  const service = await readFile(new URL('../src/services/DashboardService.js', import.meta.url), 'utf8');
  for (const field of ['registration_batch_id', 'registration_request_id', 'payment_intent_key', 'note']) {
    assert.match(service, new RegExp(field));
  }
  assert.match(service, /rpc\('get_audit_logs'/);
  assert.doesNotMatch(service, /from\('audit_logs'\)/);
  assert.match(service, /'admin_manual_renewal', 'create_renewal'/);
  assert.match(service, /metadata\?\.request_type/);
  assert.doesNotMatch(service, /return\s*'Thanh toán thành công'/);
});

test('category chart centers one bounded stage and stacks legend below on compact screens', async () => {
  const [page, charts, css] = await Promise.all([
    readFile(dashboardUrl, 'utf8'),
    readFile(chartsUrl, 'utf8'),
    readFile(cssUrl, 'utf8'),
  ]);
  assert.match(page, /class="dash-card category-chart-card"/);
  assert.match(page, /class="category-chart-stage"/);
  assert.match(css, /\.category-chart-card \.chart-container\.small\s*\{[^}]*flex:\s*1/s);
  assert.match(css, /\.category-chart-stage\s*\{[^}]*width:\s*min\(100%, 560px\)[^}]*align-items:\s*center[^}]*justify-content:\s*center[^}]*margin:\s*auto/s);
  assert.match(charts, /const compact = .*< 460/);
  assert.match(charts, /legendX: compact \? 0 : centerX \+ radius \+ 40/);
  assert.match(charts, /legendTop: compact \? centerY \+ radius \+ 28/);
});

test('expiring kiosk row is a native accessible deep-link using the existing kiosk id route', async () => {
  const source = await readFile(dashboardUrl, 'utf8');
  assert.equal(kioskDetailHref(94), '#/kiosk-detail?id=94');
  assert.equal(kioskDetailHref('a b'), '#/kiosk-detail?id=a%20b');
  assert.match(source, /<a class="expiring-item expiring-item-link" href="\$\{kioskDetailHref\(kiosk\.id\)\}" aria-label="Xem Kiosk/);
  assert.match(source, /<\/a>/);
});

test('expiring kiosk link has pointer, hover, and keyboard focus states', async () => {
  const css = await readFile(cssUrl, 'utf8');
  assert.match(css, /\.expiring-item-link\s*\{[^}]*cursor:\s*pointer/s);
  assert.match(css, /\.expiring-item-link:hover\s*\{[^}]*background:\s*var\(--bg-hover\)/s);
  assert.match(css, /\.expiring-item-link:focus-visible\s*\{[^}]*outline:/s);
});

function completedPayment(overrides = {}) {
  return {
    id: 1,
    payment_status: 'completed',
    confirmed_at: '2026-08-28T10:00:00Z',
    total_amount: 400000,
    transaction_type: 'standard',
    ...overrides,
  };
}

function approvedRequest(overrides = {}) {
  return {
    id: 1,
    status: 'approved',
    reviewed_at: '2026-08-28T10:00:00Z',
    metadata: {},
    ...overrides,
  };
}
