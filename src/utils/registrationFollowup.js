// Shared by the row actions and sidebar. These are UI classifications, not DB statuses.
export function isLegacyRequest(item) {
  const requestType = String(item?.metadata?.request_type || '').trim().toLowerCase();
  const source = String(item?.metadata?.source || '').trim().toLowerCase();
  return ['legacy', 'additional'].includes(requestType || source);
}

export function isPublicPayosRequest(item) {
  return item?.metadata?.workflow === 'public_payos' || item?.registration_batch_id != null;
}

export function hasSuccessfulPayosCheckout(item) {
  return item?.payos_checkout_created === true
    || item?.payos_has_checkout_url === true
    || item?.payos_order_status === 'paid'
    || item?.payos_state === 'awaiting_customer'
    || item?.payos_state === 'completed'
    || item?.payment_status === 'completed';
}

export function isBusinessRegistration(item) {
  return !isPublicPayosRequest(item) || hasSuccessfulPayosCheckout(item);
}

export function registrationFollowup(item = {}) {
  if (!isBusinessRegistration(item)) return { actionable: false, actions: 'none', bucket: 'hidden' };
  if (['cancelled', 'rejected'].includes(item.status) || item.payment_status === 'cancelled') {
    return { actionable: false, actions: 'none', bucket: 'closed' };
  }
  if (['awaiting_payment', 'approved'].includes(item.status)
    || item.payment_status === 'completed' || item.payos_order_status === 'paid') {
    const reasons = [];
    if (item.payos_order_status === 'paid' && item.payment_status === 'pending') {
      reasons.push('PayOS đã thanh toán nhưng Thanh toán CRM còn chờ');
    }
    if (item.payment_status === 'completed' && item.status !== 'approved') {
      reasons.push('Thanh toán đã hoàn tất nhưng Hồ sơ chưa hoàn tất');
    }
    if (!item.customer_id) reasons.push('Thiếu liên kết Khách hàng');
    if (!item.kiosk_id) reasons.push('Thiếu liên kết Kiosk');
    if (Number(item.total_amount || 0) > 0 && !item.payment_id) reasons.push('Thiếu giao dịch thanh toán');
    if (reasons.length) return { actionable: true, actions: 'needs-review', reasons, bucket: 'needs-action' };
  }
  if (item.status === 'pending') {
    if (isPublicPayosRequest(item)) return { actionable: false, actions: 'awaiting-payment', bucket: 'awaiting-payment' };
    return { actionable: true, actions: isLegacyRequest(item) ? 'legacy-review' : 'manual-review', bucket: 'needs-action' };
  }
  if (item.status === 'awaiting_payment' || item.payment_status === 'pending') {
    return { actionable: false, actions: 'awaiting-payment', bucket: 'awaiting-payment' };
  }
  if (item.status === 'approved' || item.payment_status === 'completed') {
    return { actionable: false, actions: 'none', bucket: 'completed' };
  }
  return { actionable: false, actions: 'none', bucket: 'hidden' };
}

export function countActionableRegistrations(rows = []) {
  return new Set(rows.filter(row => row?.id != null && registrationFollowup(row).actionable)
    .map(row => String(row.id))).size;
}
