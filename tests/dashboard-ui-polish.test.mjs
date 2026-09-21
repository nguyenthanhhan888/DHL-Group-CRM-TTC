import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { kioskDetailHref, recentActivityPresentation } from '../src/pages/DashboardPage.js';
import { normalizeBusinessEvents } from '../src/services/DashboardService.js';

const dashboardUrl = new URL('../src/pages/DashboardPage.js', import.meta.url);
const chartsUrl = new URL('../src/components/DashboardCharts.js', import.meta.url);
const cssUrl = new URL('../src/styles/app.css', import.meta.url);

test('recent activity maps only explicit business event types to semantic badges', () => {
  assert.deepEqual(recentActivityPresentation('registration'), {
    label: 'Đăng ký', tone: 'info', icon: 'store',
  });
  assert.deepEqual(recentActivityPresentation('renewal'), {
    label: 'Gia hạn', tone: 'success', icon: 'refresh',
  });
  assert.deepEqual(recentActivityPresentation('legacy'), {
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

test('shared business events preserve registration, renewal and legacy types', () => {
  const events = normalizeBusinessEvents([
    businessEvent('registration', 1), businessEvent('renewal', 2), businessEvent('legacy', 3),
  ]);
  assert.deepEqual(events.map((event) => event.type).sort(), ['legacy', 'registration', 'renewal']);
  assert.equal(events.every((event) => recentActivityPresentation(event.type)), true);
});

test('dashboard excludes business-log-only activity without reclassifying it', () => {
  const events = normalizeBusinessEvents([
    businessEvent('reconciliation', 11), businessEvent('expense', 12), businessEvent('update', 13),
  ]);
  assert.deepEqual(events, []);
});

test('dashboard deduplicates shared transactions, sorts by business date and limits the report to five', () => {
  const rows = [1, 2, 3, 4, 5, 6].map((id) => businessEvent(id % 2 ? 'registration' : 'renewal', id, `2026-08-${String(20 + id).padStart(2, '0')}T10:00:00Z`));
  rows.push({ ...rows[5] });
  assert.deepEqual(normalizeBusinessEvents(rows).map((event) => event.id), [
    'payment:6', 'payment:5', 'payment:4', 'payment:3', 'payment:2',
  ]);
});

test('recent activity reads the shared permission-checked business event model only', async () => {
  const service = await readFile(new URL('../src/services/DashboardService.js', import.meta.url), 'utf8');
  assert.match(service, /DASHBOARD_ACTIVITY_TYPES = \['registration', 'legacy', 'renewal'\]/);
  assert.match(service, /BusinessEventService\.list\(\{[\s\S]*context: 'dashboard', activity/);
  assert.doesNotMatch(service, /from\('payments'\)|from\('registration_requests'\)|get_audit_logs/);
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

function businessEvent(type, id, occurredAt = '2026-08-28T10:00:00Z') {
  return {
    event_key: `payment:${id}`,
    event_type: type,
    activity_label: type,
    subject_name: `Kiosk ${id}`,
    amount: 400000,
    occurred_at: occurredAt,
  };
}
