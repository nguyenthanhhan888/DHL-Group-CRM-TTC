import assert from 'node:assert/strict';
import test from 'node:test';
import { businessEventPresentation as present } from '../src/utils/businessEventPresentation.js';
import { filterPromotions } from '../src/pages/PromotionsPage.js';
import { PublicFooter, applyPublicHomepageContent } from '../src/components/PublicLayout.js';
import { ExpensesPage } from '../src/pages/ExpensesPage.js';
import { LogsPage } from '../src/pages/LogsPage.js';

const actor_name = 'Nguyễn Thanh Hân';
const cancellation = { event_key: 'audit:99', event_type: 'cancel', activity_label: 'Hủy', subject_name: 'registration_requests', actor_name, title: `${actor_name} · 123123`, secondary: '123123' };

test('cancellation uses only known record identity and never turns a reason/audit ID into a profile ID', () => {
  const fallback = present(cancellation);
  assert.equal(fallback.title, `${actor_name} đã hủy hồ sơ đăng ký`);
  assert.equal(fallback.secondary, '');
  const full = present(cancellation, { entity: 'registration_requests', action: 'cancel', record_id: '123123', reason: 'Khách yêu cầu', after: {} });
  assert.equal(full.title, `${actor_name} đã hủy hồ sơ đăng ký #123123`);
  assert.equal(full.secondary, 'Lý do: Khách yêu cầu');
  assert.equal(present(cancellation, { entity: 'registration_requests', action: 'reject', before: { facebook_name: 'Huyền Trần' } }).title, `${actor_name} đã từ chối hồ sơ đăng ký Huyền Trần`);
  assert.equal(present({ ...cancellation, subject_name: null }).title, `${actor_name} đã hủy bản ghi nghiệp vụ`);
});

test('payment correction preserves its known ID and labels its reason exactly once', () => {
  const event = { event_key: 'audit:4', event_type: 'payment', actor_name, title: `${actor_name} đã cập nhật thanh toán lịch sử #184`, secondary: 'Sai dữ liệu' };
  assert.equal(present(event).title, event.title);
  assert.equal(present(event).secondary, 'Lý do: Sai dữ liệu');
  assert.equal(present({ ...event, secondary: 'Lý do: Sai dữ liệu' }).secondary, 'Lý do: Sai dữ liệu');
});

test('expense, website and Kiosk status sentences are grounded in audit snapshots', () => {
  assert.equal(present({ event_type: 'expense', actor_name }, { action: 'create_expense', after: { amount: 450000, category: 'advertising' } }).title, `${actor_name} đã thêm chi phí 450.000 VNĐ – Quảng cáo`);
  assert.equal(present({ event_type: 'expense', actor_name }, { action: 'update_expense', after: { amount: 0, category: 'custom' } }).title, `${actor_name} đã cập nhật chi phí 0 VNĐ`);
  assert.equal(present({ event_type: 'expense', actor_name }, { action: 'create_expense', after: { category_name: 'Sự kiện cộng đồng' } }).title, `${actor_name} đã thêm chi phí – Sự kiện cộng đồng`);
  assert.equal(present({ event_type: 'website', actor_name }, { module: 'Homepage' }).title, `${actor_name} đã cập nhật nội dung Trang chủ`);
  assert.equal(present({ event_type: 'status', actor_name, subject_name: 'Ngọc Anh' }, { entity: 'kiosks', after: { is_active: false } }).title, `${actor_name} đã tạm ngưng Kiosk Ngọc Anh`);
  const kioskUpdate = { event_key: 'audit:10', event_type: 'update', actor_name, subject_name: 'Ngọc Anh' };
  assert.equal(present(kioskUpdate, { entity: 'Kiosk', action: 'update', before: { status: 'active' }, after: { status: 'suspended' } }).title, `${actor_name} đã tạm ngưng Kiosk Ngọc Anh`);
  assert.equal(present(kioskUpdate, { entity: 'Kiosk', action: 'update', before: { status: 'active' }, after: { status: 'active', note: 'Đổi ghi chú' } }).title, `${actor_name} đã cập nhật Kiosk Ngọc Anh`);
  assert.equal(present({ event_type: 'expense', actor_name }, { action: 'create_expense', after: { amount: 450000, category: 'advertising' }, reason: 'Thêm chi phí 450.000đ – Quảng cáo' }).secondary, '');
});

test('success entries stay intact and technical/raw fallback values never become business content', () => {
  const event = { event_key: 'payment:184', event_type: 'registration', actor_name: 'PayOS', title: 'Đăng ký Kiosk Huyền Trần thành công', secondary: '450.000 VNĐ · PayOS' };
  assert.equal(present(event).title, event.title);
  assert.equal(present(event).secondary, event.secondary);
  assert.equal(present({ ...cancellation, secondary: 'Mirrored from legacy logs' }).secondary, '');
  assert.doesNotMatch(present({ title: 'kiosks UPDATE', actor_name: 'System' }).title, /UPDATE|System/);
  const historicCreate = { event_key: 'audit:7', event_type: 'update', actor_name, title: `${actor_name} đã thêm khách hàng Ngọc Anh` };
  assert.equal(present(historicCreate).title, historicCreate.title);
});

test('promotion search combines current statuses with code, title and description; keeps lifecycle boundaries', () => {
  const now = Date.parse('2026-09-17T08:00:00Z');
  const rows = [
    { code: 'TRIAN', name: 'Tri ân', description: 'Đăng ký mới', is_active: true },
    { code: 'SOON', name: 'Sắp tới', is_active: true, starts_at: '2026-09-18T08:00:00Z' },
    { code: 'OLD', name: 'Đã hết hạn', is_active: true, ends_at: '2026-09-16T08:00:00Z' },
    { code: 'PAUSED', is_active: false, ends_at: '2026-09-16T08:00:00Z' },
    { code: 'BOUNDARY', is_active: true, starts_at: '2026-09-17T08:00:00Z', ends_at: '2026-09-17T08:00:00Z' },
  ];
  const original = JSON.stringify(rows);
  for (const search of [' trian ', 'TRI AN', 'dang ky moi']) assert.equal(filterPromotions(rows, { search }, now)[0].code, 'TRIAN');
  for (const [status, codes] of [['Hoạt động', ['TRIAN', 'BOUNDARY']], ['Sắp diễn ra', ['SOON']], ['Hết hạn', ['OLD']], ['Tạm ngưng', ['PAUSED']]]) {
    assert.deepEqual(filterPromotions(rows, { status }, now).map(row => row.code), codes);
  }
  assert.equal(filterPromotions(rows, { search: 'TRIAN', status: 'Hết hạn' }, now).length, 0);
  assert.equal(filterPromotions(rows, {}, now).length, rows.length);
  assert.equal(JSON.stringify(rows), original);
});

test('footer resolves canonical URLs before choosing brand icons and removes duplicate destinations', () => {
  const node = { innerHTML: '' };
  const root = { querySelectorAll: selector => selector === '[data-public-official-channels]' ? [node] : [] };
  applyPublicHomepageContent({
    heroGroupCtaUrl: 'https://facebook.com/groups/main',
    communityLinks: [{ key: 'primary', name: 'Group chính', url: 'https://m.me/old' }, { name: 'Bản sao', url: 'https://facebook.com/groups/main/' }, { name: 'Ẩn', url: 'https://facebook.com/hidden', enabled: false }],
    fanpageLabel: 'Fanpage Admin', fanpageUrl: 'https://facebook.com/admin',
    zaloContacts: [{ label: 'Zalo', url: 'https://zalo.me/123' }], hotlineLabel: 'Hotline', hotlineNumber: '0123 456 789',
  }, root);
  assert.equal((node.innerHTML.match(/icon-facebook.svg/g) || []).length, 2);
  assert.doesNotMatch(node.innerHTML, /icon-messenger|Bản sao|Ẩn/);
  assert.match(node.innerHTML, /icon-zalo.png/);
  assert.match(node.innerHTML, /tel:0123456789/);
  assert.match(node.innerHTML, /width="22" height="22"/);
  assert.match(PublicFooter(), /portal-footer-action-icon is-register/);
  applyPublicHomepageContent({ communityLinks: [{ name: 'Messenger', url: 'https://m.me/actual' }] }, root);
  assert.match(node.innerHTML, /icon-messenger.svg/);
  applyPublicHomepageContent({ communityLinks: [{ name: 'Invalid', url: 'javascript:alert(1)' }] }, root);
  assert.doesNotMatch(node.innerHTML, /javascript:/);
});

test('rendered filter markup uses one shared row, visible labels and collapsed advanced controls', () => {
  const expenses = ExpensesPage();
  const logs = LogsPage();
  for (const markup of [expenses, logs]) assert.match(markup, /admin-filter-row/);
  assert.match(expenses, /Lợi nhuận ròng/);
  assert.ok(expenses.indexOf('expense-start-date') < expenses.indexOf('expense-end-date'));
  assert.ok(expenses.indexOf('expense-end-date') < expenses.indexOf('expense-category-filter'));
  assert.match(logs, /id="log-advanced-filters" hidden/);
  assert.match(logs, /aria-expanded="false" aria-controls="log-advanced-filters"/);
});
