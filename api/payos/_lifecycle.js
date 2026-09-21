const { PAYOS_API_BASE_URL, callSupabaseRpc, getSupabaseServiceConfig, requireEnv } = require('./_utils');

function displayOrderStatus(order, paymentStatus, now = Date.now()) {
  if (order?.reconciliation_required) return 'review_required';
  if (paymentStatus === 'completed' || (order?.status === 'paid' && !order.payment_id)) return 'paid';
  if (['cancelled', 'expired', 'failed'].includes(order?.status)) return order.status;
  if (order?.expires_at && Date.parse(order.expires_at) <= now) return 'expired';
  return 'pending';
}

async function providerOrder(orderCode) {
  const response = await fetch(`${PAYOS_API_BASE_URL}/v2/payment-requests/${orderCode}`, {
    method: 'GET',
    headers: { 'x-client-id': requireEnv('PAYOS_CLIENT_ID'), 'x-api-key': requireEnv('PAYOS_API_KEY'), 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(10000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.code !== '00' || !body.data) {
    const error = new Error('Chưa đối chiếu được đơn cũ với PayOS. Vui lòng thử lại sau.');
    error.code = 'PAYOS_STATUS_UNAVAILABLE';
    throw error;
  }
  return body.data;
}

async function refreshOrder(order, { forRetry = false } = {}) {
  if (!order || order.status === 'paid') return order;
  if (order.reconciliation_required) {
    if (forRetry) throw reviewError();
    return order;
  }
  let provider = null;
  try { provider = await providerOrder(order.order_code); }
  catch (error) { if (forRetry) throw error; }
  const result = await callSupabaseRpc('sync_payos_order_status', {
    order_code_input: Number(order.order_code), provider_input: provider,
  }, { serviceRole: true });
  if (forRetry && result?.reconciliation_required) throw reviewError();
  if (forRetry && provider?.status === 'PAID') {
    const error = new Error('PayOS đã nhận tiền. Vui lòng chờ xác nhận, không thanh toán lại.');
    error.code = 'PAYOS_AWAITING_WEBHOOK'; throw error;
  }
  return result || order;
}

// This function is called only after registration ownership / renewal token / staff
// permissions have been validated by the endpoint. The DB rechecks under a lock.
async function prepareCheckoutRetry(paymentId) {
  const config = getSupabaseServiceConfig();
  const query = new URLSearchParams({ select: '*', payment_id: `eq.${Number(paymentId)}`, purpose: 'eq.crm_payment', order: 'id.desc', limit: '1' });
  const response = await fetch(`${config.url}/rest/v1/payos_orders?${query}`, {
    headers: { apikey: config.key, Authorization: `Bearer ${config.key}` },
  });
  const rows = await response.json().catch(() => null);
  if (!response.ok) throw new Error('Không đọc được lần thanh toán trước.');
  let order = rows?.[0];
  if (!order) return null;
  if (order.status === 'pending' && !order.checkout_url && Date.parse(order.created_at) > Date.now() - 30000) {
    const error = new Error('Link thanh toán đang được tạo. Vui lòng thử lại sau vài giây.');
    error.code = 'CHECKOUT_IN_PROGRESS'; throw error;
  }
  order = await refreshOrder(order, { forRetry: true });
  if (order.status === 'paid') { const error = new Error('Thanh toán đã hoàn tất.'); error.code = 'PAYMENT_ALREADY_COMPLETED'; throw error; }
  // A lost provider response is ambiguous. Keep the old mapping and wait for
  // its checkout deadline; never cancel a payable order to force regeneration.
  if (order.status === 'pending' && !order.checkout_url) {
    const error = new Error('Link cũ đang được đối chiếu. Vui lòng thử lại sau khi link hết hạn hoặc liên hệ hỗ trợ.');
    error.code = 'CHECKOUT_IN_PROGRESS'; throw error;
  }
  return order.status === 'pending' ? order : null;
}

function reviewError() {
  const error = new Error('Thanh toán cần Admin đối soát. Không chuyển khoản thêm hoặc dùng QR cũ.');
  error.code = 'PAYMENT_REVIEW_REQUIRED'; return error;
}

module.exports = { displayOrderStatus, refreshOrder, prepareCheckoutRetry };
