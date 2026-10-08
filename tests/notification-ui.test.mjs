import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const appSource = fs.readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
const notificationBlock = appSource.slice(
  appSource.indexOf('let notificationRefreshId = 0;'),
  appSource.indexOf('\nfunction applySavedTheme()'),
);

class ClassList {
  constructor(names = []) { this.names = new Set(names); }
  add(name) { this.names.add(name); }
  remove(name) { this.names.delete(name); }
  toggle(name, force) {
    if (force === undefined) force = !this.names.has(name);
    if (force) this.names.add(name); else this.names.delete(name);
  }
  contains(name) { return this.names.has(name); }
}

class NotificationNode {
  constructor(classes, id, href) {
    this.classList = new ClassList(classes.split(/\s+/));
    this.dataset = { notificationId: id };
    this.href = href;
    this.listeners = {};
  }
  addEventListener(type, listener) { this.listeners[type] = listener; }
  click() {
    const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    return { event, promise: this.listeners.click?.(event) };
  }
}

class NotificationList {
  constructor() { this.html = ''; this.nodes = []; this.policy = null; }
  set innerHTML(value) {
    this.html = value;
    this.nodes = [...value.matchAll(/<a class="([^"]+)" data-notification-id="([^"]+)" href="([^"]+)"/g)]
      .map(match => new NotificationNode(match[1], match[2], match[3]));
    this.policy = value.includes('admin-notification-policy')
      ? { textContent: '', attributes: {}, setAttribute(name, setting) { this.attributes[name] = setting; } }
      : null;
  }
  get innerHTML() { return this.html; }
  querySelectorAll(selector) { return selector === '[data-notification-id]' ? this.nodes : []; }
  querySelector(selector) { return selector === '.admin-notification-policy' ? this.policy : null; }
}

function notification(id, overrides = {}) {
  return {
    id, userId: 'user-1', read: false, resolved: false, tone: 'pending', icon: 'check',
    title: `Notification ${id}`, description: `Message ${id}`, timeLabel: 'Vừa xong', href: `#/target/${id}`,
    ...overrides,
  };
}

function createHarness(data, serviceOverrides = {}) {
  const count = { textContent: 'stale', classList: new ClassList(['hidden']) };
  const markAll = { disabled: false, onclick: null };
  const list = new NotificationList();
  const center = { closed: false, removeAttribute(name) { if (name === 'open') this.closed = true; } };
  const document = {
    querySelector(selector) {
      return {
        '[data-notification-count]': count,
        '[data-notification-list]': list,
        '[data-notification-mark-all]': markAll,
        '.admin-notification-center': center,
      }[selector] || null;
    },
  };
  const calls = [];
  const service = {
    async getActionable() { return data; },
    async markRead(...args) { calls.push(['markRead', ...args]); },
    async markAllRead(...args) { calls.push(['markAllRead', ...args]); },
    ...serviceOverrides,
  };
  const window = { location: { href: '#/current' } };
  const factory = new Function(
    'AdminNotificationService', 'document', 'window', 'escapeHtml', 'renderIcon',
    `${notificationBlock}; return { refreshAdminNotifications };`,
  );
  const ui = factory(service, document, window, String, icon => `<i>${icon}</i>`);
  return { ...ui, count, markAll, list, center, calls, window };
}

test('server unread count renders in the bell and resolved-unread remains unread', async () => {
  const resolved = notification('2', { resolved: true, tone: 'resolved' });
  const harness = createHarness({ items: [notification('1'), resolved], unreadCount: 2, summaryText: '' });
  await harness.refreshAdminNotifications();
  assert.equal(harness.count.textContent, '2');
  assert.equal(harness.count.classList.contains('hidden'), false);
  const node = harness.list.nodes.find(item => item.dataset.notificationId === '2');
  assert.equal(node.classList.contains('is-unread'), true);
  assert.match(harness.list.innerHTML, /Chưa đọc · Đã kết thúc/);
});

test('click marks one read immediately, decrements badge, then uses item href', async () => {
  const items = [notification('1'), notification('2')];
  const harness = createHarness({ items, unreadCount: 2, summaryText: '' });
  await harness.refreshAdminNotifications();
  const clicked = harness.list.nodes.find(item => item.dataset.notificationId === '1').click();
  assert.equal(clicked.event.defaultPrevented, true);
  assert.equal(harness.count.textContent, '1');
  assert.equal(harness.list.nodes.find(item => item.dataset.notificationId === '1').classList.contains('is-read'), true);
  await clicked.promise;
  assert.deepEqual(harness.calls, [['markRead', '1', 'user-1']]);
  assert.equal(harness.window.location.href, '#/target/1');
  assert.equal(harness.center.closed, true);
});

test('mark all changes visible items and badge only after the service succeeds', async () => {
  let resolveMarkAll;
  const waiting = new Promise(resolve => { resolveMarkAll = resolve; });
  const calls = [];
  const items = [notification('1'), notification('2', { resolved: true })];
  const harness = createHarness(
    { items, unreadCount: 2, summaryText: '' },
    { markAllRead: async (...args) => { calls.push(args); await waiting; } },
  );
  await harness.refreshAdminNotifications();
  const action = harness.markAll.onclick();
  assert.equal(harness.count.textContent, '2');
  resolveMarkAll();
  await action;
  assert.equal(harness.count.textContent, '');
  assert.equal(harness.count.classList.contains('hidden'), true);
  assert.equal(harness.list.nodes.every(node => node.classList.contains('is-read')), true);
  assert.equal(calls.length, 1);
});

test('zero unread uses neutral wording while preserving read history and href', async () => {
  const readHistory = notification('9', { read: true, resolved: true, href: '#/payments' });
  const harness = createHarness({ items: [readHistory], unreadCount: 0, summaryText: '' });
  await harness.refreshAdminNotifications();
  assert.match(harness.list.innerHTML, /Không có thông báo mới/);
  assert.doesNotMatch(harness.list.innerHTML, /Mọi việc đã được xử lý/);
  assert.match(harness.list.innerHTML, /Notification 9/);
  assert.equal(harness.list.nodes[0].href, '#/payments');
});

test('failed refresh hides a stale unread badge and disables mark-all', async () => {
  const harness = createHarness(
    { items: [], unreadCount: 0, summaryText: '' },
    { getActionable: async () => { throw new Error('offline'); } },
  );
  harness.count.textContent = '8';
  harness.count.classList.remove('hidden');
  await harness.refreshAdminNotifications();
  assert.equal(harness.count.textContent, '');
  assert.equal(harness.count.classList.contains('hidden'), true);
  assert.equal(harness.markAll.disabled, true);
  assert.match(harness.list.innerHTML, /Không thể tải thông báo/);
});
