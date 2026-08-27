import { requireSupabaseClient, runQuery } from './BaseService.js';

const STORAGE_KEY = 'dhl:admin-notification-state:v1';

export const AdminNotificationService = {
  async getActionable() {
    const supabase = requireSupabaseClient();
    const [pendingResult, awaitingResult, reportResult] = await Promise.all([
      runQuery(supabase.from('registration_requests').select('id,facebook_name,submitted_at,metadata', { count: 'exact' }).eq('status', 'pending').order('submitted_at', { ascending: false }).limit(10)),
      runQuery(supabase.from('registration_requests').select('id,facebook_name,submitted_at', { count: 'exact' }).eq('status', 'awaiting_payment').order('submitted_at', { ascending: false }).limit(10)),
      runQuery(supabase.rpc('get_reports_data', { p_report_type: 'overview', p_start_date: null, p_end_date: null, p_customer_id: null, p_kiosk_id: null, p_category_id: null, p_business_type_id: null, p_payment_status: null, p_kiosk_status: null, p_sort_by: null, p_sort_direction: 'desc', p_page: 1, p_page_size: 25 })),
    ]);
    const pending = pendingResult.data || [];
    const awaiting = awaitingResult.data || [];
    const report = reportResult.data || {};
    const kiosks = (report.priorityKiosks || []).filter((item) => ['warning', 'expired'].includes(String(item.derivedStatus || '').toLowerCase()));
    const items = [
      ...pending.map((item) => notification({ id: `request:pending:${item.id}:${item.submitted_at || ''}`, createdAt: item.submitted_at, tone: 'pending', icon: 'check', title: isAdditional(item) ? 'Bổ sung Kiosk chờ xử lý' : 'Hồ sơ Kiosk chờ duyệt', description: `${item.facebook_name || 'Khách hàng'} đang chờ Ban quản trị`, href: '#/registration-requests?status=pending' })),
      ...awaiting.map((item) => notification({ id: `request:awaiting_payment:${item.id}:${item.submitted_at || ''}`, createdAt: item.submitted_at, tone: 'warning', icon: 'clock', title: 'Hồ sơ chờ thanh toán', description: `${item.facebook_name || 'Khách hàng'} chưa hoàn tất thanh toán`, href: '#/registration-requests?status=awaiting_payment' })),
      ...kiosks.map((item) => notification({ id: `kiosk:${String(item.derivedStatus).toLowerCase()}:${item.id}:${item.endDate || ''}`, createdAt: item.endDate, tone: item.derivedStatus === 'expired' ? 'danger' : 'warning', icon: item.derivedStatus === 'expired' ? 'x-circle' : 'clock', title: item.derivedStatus === 'expired' ? 'Kiosk đã hết hạn' : 'Kiosk sắp hết hạn', description: item.derivedStatus === 'expired' ? `${item.facebookName || 'Kiosk'} đã hết hạn` : `${item.facebookName || 'Kiosk'} còn ${item.daysLeft} ngày`, href: `#/kiosk-detail?id=${encodeURIComponent(item.id)}` })),
    ];
    const kioskCount = Number(report.summary?.expiredKiosks || 0) + Number(report.summary?.expiringSoon || 0);
    const pendingCount = pendingResult.count == null ? pending.length : Number(pendingResult.count);
    const awaitingCount = awaitingResult.count == null ? awaiting.length : Number(awaitingResult.count);
    const uniqueItems = [...new Map(items.map((item) => [item.id, item])).values()];
    const state = readState();
    const visibleItems = uniqueItems.map((item) => ({ ...item, read: Boolean(state[item.id]?.readAt) }));
    pruneState(state, new Set(uniqueItems.map((item) => item.id)));
    const unreadCount = visibleItems.filter((item) => !item.read).length;
    return {
      items: visibleItems,
      count: unreadCount,
      unreadCount,
      registrationCount: pendingCount,
      pendingReviewCount: pendingCount,
      awaitingPaymentCount: awaitingCount,
      summaryText: `${pendingCount} hồ sơ chờ duyệt · ${awaitingCount} hồ sơ chờ thanh toán · ${kioskCount} Kiosk cần chú ý`,
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
