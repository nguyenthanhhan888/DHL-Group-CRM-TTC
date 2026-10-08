// Shared by the row actions and sidebar. These are UI classifications, not DB statuses.
export function isLegacyRequest(item) {
  const requestType = String(item?.metadata?.request_type || '').trim().toLowerCase();
  const source = String(item?.metadata?.source || '').trim().toLowerCase();
  return ['legacy', 'additional'].includes(requestType || source);
}

export function registrationFollowup(item = {}) {
  if (item.status === 'awaiting_payment') return { actionable: true, actions: 'awaiting-payment' };
  const missingRequiredPayment = Number(item.total_amount || 0) > 0 && !item.payment_id;
  if (item.status === 'approved' && isLegacyRequest(item)
    && (!item.customer_id || !item.kiosk_id || missingRequiredPayment)) {
    return { actionable: true, actions: 'needs-review' };
  }
  if (item.status === 'pending') {
    // Automated/batched requests still need follow-up, but never gain manual review buttons.
    const automated = item.metadata?.workflow === 'public_payos' || item.registration_batch_id;
    return { actionable: true, actions: automated ? 'follow-up' : isLegacyRequest(item) ? 'legacy-review' : 'manual-review' };
  }
  return { actionable: false, actions: 'none' };
}

export function countActionableRegistrations(rows = []) {
  return new Set(rows.filter(row => row?.id != null && registrationFollowup(row).actionable)
    .map(row => String(row.id))).size;
}
