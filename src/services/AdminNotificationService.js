import { requireSupabaseClient, runQuery } from './BaseService.js';

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
      ...pending.map((item) => ({ id: `request:${item.id}`, tone: 'pending', icon: 'check', title: isAdditional(item) ? 'Bổ sung Kiosk chờ xử lý' : 'Đơn đăng ký chờ duyệt', description: `${item.facebook_name || 'Khách hàng'} đang chờ Ban quản trị`, href: '#/registration-requests?status=pending' })),
      ...awaiting.map((item) => ({ id: `awaiting:${item.id}`, tone: 'warning', icon: 'clock', title: 'Hồ sơ chờ thanh toán', description: `${item.facebook_name || 'Khách hàng'} chưa hoàn tất thanh toán`, href: '#/registration-requests?status=awaiting_payment' })),
      ...kiosks.map((item) => ({ id: `kiosk:${item.id}`, tone: item.derivedStatus === 'expired' ? 'danger' : 'warning', icon: item.derivedStatus === 'expired' ? 'x-circle' : 'clock', title: item.derivedStatus === 'expired' ? 'Kiosk đã hết hạn' : 'Kiosk sắp hết hạn', description: item.derivedStatus === 'expired' ? `${item.facebookName || 'Kiosk'} đã hết hạn` : `${item.facebookName || 'Kiosk'} còn ${item.daysLeft} ngày`, href: `#/kiosk-detail?id=${encodeURIComponent(item.id)}` })),
    ];
    const kioskCount = Number(report.summary?.expiredKiosks || 0) + Number(report.summary?.expiringSoon || 0);
    const pendingCount = pendingResult.count == null ? pending.length : Number(pendingResult.count);
    const awaitingCount = awaitingResult.count == null ? awaiting.length : Number(awaitingResult.count);
    return {
      items,
      count: pendingCount + awaitingCount + kioskCount,
      registrationCount: pendingCount,
      pendingReviewCount: pendingCount,
      awaitingPaymentCount: awaitingCount,
      summaryText: `${pendingCount} đơn chờ duyệt · ${awaitingCount} hồ sơ chờ thanh toán · ${kioskCount} Kiosk cần chú ý`,
    };
  },
};

function isAdditional(item) {
  const source = String(item.metadata?.source || item.metadata?.registration_type || item.metadata?.request_type || '').toLowerCase();
  return source.includes('legacy') || source.includes('additional');
}
