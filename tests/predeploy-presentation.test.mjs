import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import { NAV_SECTIONS } from '../src/constants/navigation.js';
import { AppLayout, syncNavigationGroups } from '../src/layouts/AppLayout.js';
import { promotionDateDefaults } from '../src/pages/PromotionsPage.js';
import { resolveReviewContexts } from '../src/services/ReviewContextService.js';
import { integrityPresentation, reviewReference, eventReviewReference } from '../src/utils/reviewPresentation.js';
import { businessEventPresentation } from '../src/utils/businessEventPresentation.js';
import { DetailFields } from '../src/components/DetailFields.js';

test('sidebar preserves every route and permission, with CRM expanded and only TTC/System collapsible', () => {
  assert.deepEqual(NAV_SECTIONS.flatMap(section => section.items.map(item => item.route)), [
    'user', 'user-profile', 'user-kiosks', 'user-register-kiosk', 'payments-mine', 'user-announcements', 'user-support', 'dashboard',
    'customers', 'kiosks', 'register', 'registration-requests', 'categories', 'business-types', 'promotions', 'expenses', 'reports',
    'ttc', 'admin/ttc', 'admin-ttc-announcements', 'admin-ttc-campaigns', 'admin-ttc-tasks', 'admin-ttc-wallets', 'admin-ttc-settings', 'admin-ttc-logs',
    'user-management', 'logs', 'settings',
  ]);
  const crm = NAV_SECTIONS.find(section => section.label === 'QUẢN LÝ CRM');
  assert.ok(!crm.collapsible);
  assert.equal(NAV_SECTIONS.filter(section => section.collapsible).length, 2);
  const ttc = NAV_SECTIONS.find(section => section.items.some(item => item.route === 'ttc'));
  const admin = ttc.items.find(item => item.route === 'admin/ttc');
  assert.equal(admin.permission, 'admin-ttc');
  assert.equal(admin.matchRoute, 'admin');
  assert.notEqual(admin.label, ttc.items.find(item => item.route === 'ttc').label);
  const markup = AppLayout({ navSections: NAV_SECTIONS, user: { display_name: 'Tên thật <QA>', is_system_admin: true } });
  assert.doesNotMatch(markup, /<details[^>]*data-nav-group[^>]*\sopen/);
  assert.match(markup, /Tên thật &lt;QA&gt;/);
  assert.match(markup, /sidebar-account-dropdown[\s\S]*href="#\/user-profile"[\s\S]*<hr>[\s\S]*data-logout[\s\S]*Đăng xuất/);
  const personal = AppLayout({ navSections: [NAV_SECTIONS[0]], user: { username: 'member', web_access_enabled: true } });
  assert.doesNotMatch(personal, /data-nav-route="(?:dashboard|admin\/ttc)"/);
  assert.match(personal, /Người dùng Web/);
  assert.doesNotMatch(personal, /Quản trị hệ thống/);
});

test('actual router navigation marks BOTH TTC destinations and opens active groups after navigation', () => {
  const app = fs.readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  const source = app.slice(app.indexOf('function getRouteSubPath()'), app.indexOf('function updateSupabaseBadge'));
  const routes = ['ttc', 'admin/ttc', 'logs', 'settings'];
  const links = routes.map(route => ({ dataset: { navRoute: route, ...(route === 'admin/ttc' ? { navMatchRoute: 'admin' } : {}) },
    active: false, attributes: {}, classList: { toggle(_, value) { links.find(link => link.classList === this).active = value; } },
    setAttribute(key, value) { this.attributes[key] = value; }, removeAttribute(key) { delete this.attributes[key]; } }));
  const groups = [routes.slice(0, 2), routes.slice(2)].map(children => ({ open: false,
    classList: { contains: name => name === 'nav-section-collapsible', toggle() {} },
    querySelector: selector => selector === '.nav-item.active' ? links.find(link => children.includes(link.dataset.navRoute) && link.active) : { setAttribute() {} },
  }));
  const document = { querySelectorAll: selector => selector === '[data-nav-route]' ? links : groups };
  const box = { document, window: { location: { hash: '' } }, syncNavigationGroups: () => syncNavigationGroups(document) };
  vm.createContext(box); vm.runInContext(source, box);
  for (const [hash, route, active] of [['#/ttc', 'ttc', 'ttc'], ['#/admin/ttc', 'admin', 'admin/ttc'], ['#/ttc-earn', 'ttc-earn', 'ttc'], ['#/logs', 'logs', 'logs'], ['#/homepage-content', 'homepage-content', 'settings']]) {
    box.window.location.hash = hash;
    box.setActiveNavigation(route);
    assert.deepEqual(links.filter(link => link.active).map(link => link.dataset.navRoute), [active]);
    assert.equal(groups[0].open, ['ttc', 'admin/ttc'].includes(active));
    assert.equal(groups[1].open, ['logs', 'settings'].includes(active));
    assert.equal(links.find(link => link.active).attributes['aria-current'], 'page');
  }
});

test('new promotion defaults are runtime Vietnam time across year boundaries; editing empty limits stays empty', () => {
  assert.deepEqual(promotionDateDefaults({}, new Date('2031-12-31T20:45:00Z')), { starts_at: '2032-01-01T03:45', ends_at: '2032-01-01T03:45' });
  assert.deepEqual(promotionDateDefaults({ id: 4, starts_at: null, ends_at: null }), { starts_at: '', ends_at: '' });
  assert.equal(promotionDateDefaults({ id: 4, starts_at: '2026-09-20T01:30:00Z' }).starts_at, '2026-09-20T08:30');
  const fields = DetailFields([['Lượt thành công', 1], ['Khách hàng', '<Lan>']]);
  assert.match(fields, /<dt>Lượt thành công<\/dt><dd>1<\/dd>/);
  assert.match(fields, /&lt;Lan&gt;/);
});

test('review contexts recover explicit payment, request, batch and kiosk ownership without inventing identities', async () => {
  const data = {
    payos_orders: [{ id: 88, payment_id: 348 }],
    payments: [{ id: 348, kiosk_id: 4, total_amount: 150000, payment_method: 'transfer', payment_status: 'completed' }, { id: 343, registration_batch_id: 5 }],
    registration_requests: [{ id: 9, payment_id: 343, kiosk_id: 6, customer_id: 3 }],
    registration_batches: [{ id: 5, customer_id: 3 }], registration_batch_items: [{ id: 1, batch_id: 5, kiosk_id: 7 }],
    kiosks: [{ id: 4, customer_id: 2, facebook_name: 'Ngọc Anh' }, { id: 6, customer_id: 3, facebook_name: 'Kiosk A' }, { id: 7, customer_id: 3, facebook_name: 'Kiosk B' }],
    customers: [{ id: 2, facebook_name: 'Lan Lan' }, { id: 3, facebook_name: 'Minh' }],
  };
  const before = JSON.stringify(data);
  const read = async (table, columns, ids, key = 'id') => data[table].filter(row => ids.includes(String(row[key])));
  const [order, batch, missing] = await resolveReviewContexts([{ orderId: 88 }, { paymentId: 343 }, { paymentId: 999 }], read);
  assert.equal(order.payment.id, 348);
  assert.equal(order.customers[0].facebook_name, 'Lan Lan');
  assert.deepEqual(batch.kiosks.map(row => row.facebook_name), ['Kiosk A', 'Kiosk B']);
  assert.deepEqual(batch.customers.map(row => row.facebook_name), ['Minh']);
  assert.deepEqual(missing.customers, []);
  assert.equal(JSON.stringify(data), before);
  const denied = await resolveReviewContexts([{ paymentId: 348 }], async () => { throw new Error('Denied'); });
  assert.deepEqual(denied[0].customers, []);
});

test('integrity issues retain amount/status semantics and show actionable business copy', () => {
  const row = { entityType: 'payment', recordId: '343', paymentId: 343, issueCode: 'payment_without_kiosk', customerName: 'Không tên', kioskName: 'Không tên', totalAmount: 200000, status: 'cancelled' };
  const before = JSON.stringify(row);
  const view = integrityPresentation(row, { customers: [{ facebook_name: 'Lan Lan' }], kiosks: [{ facebook_name: 'Ngọc Anh' }] });
  assert.equal(view.title, 'Thanh toán #343 cần kiểm tra');
  assert.equal(view.customer, 'Lan Lan'); assert.equal(view.kiosk, 'Ngọc Anh');
  assert.equal(view.issue, 'Thiếu liên kết Kiosk');
  assert.equal(view.href, '#/payment-detail?id=343');
  assert.equal(integrityPresentation(row).customer, 'Không xác định');
  assert.equal(integrityPresentation({ entityType: 'kiosk', recordId: 4, totalAmount: 0 }).amount, '');
  assert.equal(reviewReference(row).paymentId, 343);
  assert.equal(JSON.stringify(row), before);
});

test('reconciliation journal translates technical terms, uses verified relationships and never treats an order ID as payment ID', () => {
  const event = { event_type: 'reconciliation', event_key: 'payment:348', title: 'Thanh toán #348 cần đối soát intent', amount: 150000, secondary: '150.000 VNĐ · transfer', result: 'Hoàn tất' };
  const item = businessEventPresentation(event, { payment: { id: 348, payment_method: 'transfer', payment_status: 'completed' }, customers: [{ facebook_name: 'Lan Lan' }], kiosks: [{ facebook_name: 'Ngọc Anh' }] });
  assert.equal(item.title, 'Thanh toán #348 của Lan Lan cần kiểm tra');
  assert.equal(item.secondary, 'Kiosk: Ngọc Anh · 150.000 VNĐ · Chuyển khoản');
  assert.equal(item.reviewFields.find(([label]) => label === 'Loại giao dịch')[1], 'Không xác định');
  const unknown = businessEventPresentation({ ...event, event_key: 'reconciliation:99', secondary: 'Không xác định được intent' });
  assert.doesNotMatch(JSON.stringify(unknown), /intent|event_key|transfer|#99/);
  assert.match(unknown.reviewFields[0][1], /Không xác định được khách hàng/);
  assert.deepEqual(eventReviewReference({ event_key: 'reconciliation:99' }), { orderId: '99' });
  assert.deepEqual(eventReviewReference({ event_key: 'audit:99' }), {});
});
