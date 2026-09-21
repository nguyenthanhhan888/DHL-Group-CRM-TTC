import { requireSupabaseClient, runQuery } from './BaseService.js';

const STORAGE_KEY = 'dhl:admin-notification-state:v1';

export const AdminNotificationService = {
  async getActionable() {
    const supabase = requireSupabaseClient();
    const { data } = await runQuery(supabase.rpc('get_registration_actionable_summary'));
    const pending = data?.pendingItems || [];
    const awaiting = data?.awaitingPaymentItems || [];
    const pendingCount = Number(data?.pendingReviewCount ?? pending.length);
    const reconciliationCount = Number(data?.reconciliationCount || 0);
    const awaitingCount = Number(data?.awaitingPaymentCount ?? awaiting.length);
    const items = [
      ...pending.map((item) => notification({ id: `request:pending:${item.id}:${item.submitted_at || ''}`, createdAt: item.submitted_at, tone: 'pending', icon: 'check', title: isAdditional(item) ? 'Bổ sung Kiosk chờ xử lý' : 'Hồ sơ Kiosk chờ duyệt', description: `${item.facebook_name || 'Khách hàng'} đang chờ Ban quản trị`, href: '#/registration-requests?status=pending' })),
      ...(reconciliationCount ? [notification({ id: `reconciliation:summary:${reconciliationCount}`, createdAt: new Date().toISOString(), tone: 'danger', icon: 'warning', title: 'Giao dịch cần đối soát', description: `${reconciliationCount} giao dịch cần Admin xử lý`, href: '#/payments' })] : []),
    ];
    const uniqueItems = [...new Map(items.map((item) => [item.id, item])).values()];
    const state = readState();
    const visibleItems = uniqueItems.map((item) => ({ ...item, read: Boolean(state[item.id]?.readAt) }));
    pruneState(state, new Set(uniqueItems.map((item) => item.id)));
    const unreadCount = pendingCount + reconciliationCount;
    return {
      items: visibleItems,
      count: unreadCount,
      unreadCount,
      registrationCount: pendingCount + reconciliationCount,
      pendingReviewCount: pendingCount,
      awaitingPaymentCount: awaitingCount,
      reconciliationCount,
      summaryText: `${pendingCount} hồ sơ chờ duyệt · ${reconciliationCount} giao dịch cần đối soát · ${awaitingCount} hồ sơ chờ thanh toán`,
    };
  },

  markRead(id) {
    const state = readState();
    state[id] = { readAt: new Date().toISOString() };
    writeState(state);
  },

  markAllRead(items = []) {
    const state = readState();
    const readAt = new Date().toISOString();
    items.forEach((item) => { state[item.id] = { readAt }; });
    writeState(state);
  },
};

function isAdditional(item) {
  const source = String(item.metadata?.source || item.metadata?.registration_type || item.metadata?.request_type || '').toLowerCase();
  return source.includes('legacy') || source.includes('additional');
}

function notification(item) {
  return { ...item, timeLabel: relativeTime(item.createdAt) };
}

function relativeTime(value) {
  if (!value) return 'Vừa cập nhật';
  const elapsed = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(elapsed)) return 'Vừa cập nhật';
  const minutes = Math.max(0, Math.floor(elapsed / 60_000));
  if (minutes < 1) return 'Vừa xong';
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} giờ trước`;
  return `${Math.floor(hours / 24)} ngày trước`;
}

function readState() {
  try { return JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) || '{}'); } catch { return {}; }
}

function writeState(state) {
  try { globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* Storage can be unavailable. */ }
}

function pruneState(state, activeIds) {
  let changed = false;
  Object.keys(state).forEach((id) => { if (!activeIds.has(id)) { delete state[id]; changed = true; } });
  if (changed) writeState(state);
}
