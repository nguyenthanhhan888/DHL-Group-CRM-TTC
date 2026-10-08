import { requireSupabaseClient, runQuery } from './BaseService.js';

export const NOTIFICATION_RETENTION_DAYS = 90;
export const NOTIFICATION_WINDOW_LIMIT = 100;

let pendingMutation = Promise.resolve();
let pendingMutationError = null;

export const AdminNotificationService = {
  async getActionable() {
    await flushPendingMutations();
    const supabase = requireSupabaseClient();
    const { data: authData, error } = await supabase.auth.getSession();
    if (error) throw error;
    const userId = authData?.session?.user?.id;
    if (!userId) return { items: [], count: 0, unreadCount: 0 };

    const { data } = await runQuery(supabase.rpc('get_crm_notifications'));
    const unreadCount = Number(data?.unreadCount || 0);
    return {
      items: (data?.items || []).map(item => notification(item, userId)),
      count: unreadCount,
      unreadCount,
      summaryText: 'Đã đọc không có nghĩa là đã xử lý. Thông báo chưa đọc được giữ lại; lịch sử đã kết thúc và đã đọc được giữ 90 ngày.',
    };
  },

  markRead(id) {
    return enqueueMutation(() => runQuery(requireSupabaseClient().rpc(
      'mark_crm_notification_read',
      { p_notification_id: id },
    )));
  },

  markAllRead() {
    return enqueueMutation(() => runQuery(requireSupabaseClient().rpc(
      'mark_all_crm_notifications_read',
    )));
  },
};

function notification(item, userId) {
  const resolved = Boolean(item.resolved_at);
  const reconciliation = item.notification_type === 'payment_reconciliation';
  return {
    id: String(item.id),
    userId,
    type: item.notification_type,
    entityType: item.entity_type,
    entityId: item.entity_id,
    occurrenceKey: item.occurrence_key,
    createdAt: item.created_at,
    resolvedAt: item.resolved_at,
    readAt: item.read_at,
    read: Boolean(item.read_at),
    actionable: !resolved,
    resolved,
    tone: resolved ? 'resolved' : reconciliation ? 'danger' : 'pending',
    icon: resolved ? 'check-circle' : reconciliation ? 'warning' : 'check',
    title: item.title,
    description: item.message,
    targetUrl: item.target_url,
    href: item.target_url,
    timeLabel: relativeTime(item.created_at),
  };
}

function enqueueMutation(action) {
  pendingMutation = pendingMutation
    .then(action)
    .catch(error => { pendingMutationError ||= error; });
  return pendingMutation;
}

async function flushPendingMutations() {
  await pendingMutation;
  if (!pendingMutationError) return;
  const error = pendingMutationError;
  pendingMutationError = null;
  throw error;
}

function relativeTime(value) {
  const elapsed = Date.now() - Date.parse(value);
  if (!Number.isFinite(elapsed)) return 'Vừa cập nhật';
  const minutes = Math.max(0, Math.floor(elapsed / 60000));
  if (minutes < 1) return 'Vừa xong';
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} giờ trước` : `${Math.floor(hours / 24)} ngày trước`;
}
