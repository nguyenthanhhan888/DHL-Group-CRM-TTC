import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const calls = [];
let feedData;
const client = {
  auth: {
    getSession: async () => ({
      data: { session: { user: { id: 'user-1' } } },
      error: null,
    }),
  },
  rpc(name, args) {
    calls.push({ name, args, argumentCount: arguments.length });
    if (name === 'get_crm_notifications') {
      return Promise.resolve({ data: feedData, error: null });
    }
    return Promise.resolve({ data: null, error: null });
  },
};

globalThis.window = {
  DHL_CONFIG: {
    supabaseUrl: 'https://notification-service.test',
    supabaseAnonKey: 'test-key',
  },
  supabase: { createClient: () => client },
};
globalThis.localStorage = new Proxy({}, {
  get() { throw new Error('AdminNotificationService must not access localStorage'); },
});

const { AdminNotificationService } = await import('../src/services/AdminNotificationService.js');

function setFeed() {
  feedData = {
    unreadCount: 7,
    items: [
      {
        id: 11,
        notification_type: 'registration_review',
        entity_type: 'registration_request',
        entity_id: '81',
        occurrence_key: 'registration_review:registration_request:81:1',
        title: 'Hồ sơ Kiosk chờ duyệt',
        message: 'Kiosk A đang chờ Ban quản trị',
        target_url: '#/registration-requests?status=pending',
        created_at: '2026-10-08T08:00:00Z',
        resolved_at: null,
        read_at: '2026-10-08T09:00:00Z',
      },
      {
        id: 12,
        notification_type: 'payment_reconciliation',
        entity_type: 'payos_order',
        entity_id: '91',
        occurrence_key: 'payment_reconciliation:payos_order:91:1',
        title: 'Yêu cầu đối soát đã kết thúc',
        message: 'Giao dịch #91 không còn được đánh dấu cần đối soát',
        target_url: '#/payments',
        created_at: '2026-10-08T07:00:00Z',
        resolved_at: '2026-10-08T10:00:00Z',
        read_at: null,
      },
    ],
  };
  calls.length = 0;
}

test('feed maps persistent RPC fields to the existing UI item contract', async () => {
  setFeed();
  const result = await AdminNotificationService.getActionable();
  assert.deepEqual(calls, [{ name: 'get_crm_notifications', args: undefined, argumentCount: 1 }]);
  assert.deepEqual(result.items[0], {
    id: '11', userId: 'user-1', type: 'registration_review',
    entityType: 'registration_request', entityId: '81',
    occurrenceKey: 'registration_review:registration_request:81:1',
    createdAt: '2026-10-08T08:00:00Z', resolvedAt: null,
    readAt: '2026-10-08T09:00:00Z', read: true,
    actionable: true, resolved: false, tone: 'pending', icon: 'check',
    title: 'Hồ sơ Kiosk chờ duyệt',
    description: 'Kiosk A đang chờ Ban quản trị',
    targetUrl: '#/registration-requests?status=pending',
    href: '#/registration-requests?status=pending',
    timeLabel: result.items[0].timeLabel,
  });
});

test('unread count comes from the server instead of the returned page length', async () => {
  setFeed();
  const result = await AdminNotificationService.getActionable();
  assert.equal(result.unreadCount, 7);
  assert.equal(result.count, 7);
  assert.equal(result.items.length, 2);
});

test('mark one calls mark_crm_notification_read with the exact migration parameter', async () => {
  calls.length = 0;
  await AdminNotificationService.markRead('12', 'ignored-legacy-user-id');
  assert.deepEqual(calls, [{
    name: 'mark_crm_notification_read',
    args: { p_notification_id: '12' },
    argumentCount: 2,
  }]);
});

test('mark all calls mark_all_crm_notifications_read without parameters', async () => {
  calls.length = 0;
  await AdminNotificationService.markAllRead([{ id: '11' }]);
  assert.deepEqual(calls, [{
    name: 'mark_all_crm_notifications_read',
    args: undefined,
    argumentCount: 1,
  }]);
});

test('resolved notification remains unread when server read_at is null', async () => {
  setFeed();
  const result = await AdminNotificationService.getActionable();
  const resolved = result.items.find(item => item.id === '12');
  assert.equal(resolved.resolved, true);
  assert.equal(resolved.actionable, false);
  assert.equal(resolved.read, false);
  assert.equal(resolved.href, '#/payments');
});

test('service has no localStorage read-state dependency', async () => {
  setFeed();
  await assert.doesNotReject(() => AdminNotificationService.getActionable());
  const source = fs.readFileSync(new URL('../src/services/AdminNotificationService.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /localStorage|STORAGE_KEY|readState|writeState/);
});
