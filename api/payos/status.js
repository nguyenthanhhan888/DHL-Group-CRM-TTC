const {
  getSupabaseServiceConfig,
  getSupabaseUserConfig,
  sendError,
} = require('./_utils');

module.exports = async function payosStatusHandler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Chỉ hỗ trợ phương thức GET.');
  }

  try {
    const orderCode = normalizeOrderCode(req.query?.orderCode || req.query?.order_code);
    const paymentLinkId = String(req.query?.paymentLinkId || req.query?.payment_link_id || '').trim();
    const accessToken = normalizeBearerToken(req.headers.authorization);

    const authOrder = accessToken ? await fetchOrderWithUserAccess(orderCode, accessToken) : null;
    const order = authOrder || await fetchOrderWithPaymentLink(orderCode, paymentLinkId);
    if (!order) {
      return sendError(res, 404, 'PAYOS_ORDER_NOT_FOUND', 'Không tìm thấy thanh toán PayOS.');
    }

    return res.status(200).json({
      success: true,
      orderCode: Number(order.order_code),
      status: String(order.status || ''),
      amount: Number(order.amount || 0),
      confirmedAt: order.confirmed_at || null,
      processedAt: order.processed_at || null,
    });
  } catch (error) {
    const status = error?.code === 'MISSING_ENV' ? 500 : 400;
    return sendError(
      res,
      status,
      error?.code || 'PAYOS_STATUS_ERROR',
      error?.message || 'Không kiểm tra được trạng thái PayOS.',
    );
  }
};

function normalizeOrderCode(value) {
  const orderCode = Number(value);
  if (!Number.isSafeInteger(orderCode) || orderCode <= 0) {
    throw new Error('Mã đơn PayOS không hợp lệ.');
  }
  return orderCode;
}

function normalizeBearerToken(value) {
  const token = String(value || '').replace(/^Bearer\s+/i, '').trim();
  return token || '';
}

async function fetchOrderWithUserAccess(orderCode, accessToken) {
  const config = getSupabaseUserConfig();
  const response = await fetch(`${config.url}/rest/v1/payos_orders?select=order_code,status,amount,confirmed_at,processed_at,payment_link_id&order_code=eq.${orderCode}&limit=1`, {
    headers: {
      apikey: config.key,
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const data = await safeJson(response);
  if (!response.ok) return null;
  return Array.isArray(data) ? data[0] : null;
}

async function fetchOrderWithPaymentLink(orderCode, paymentLinkId) {
  if (!paymentLinkId) return null;
  const config = getSupabaseServiceConfig();
  const query = new URLSearchParams({
    select: 'order_code,status,amount,confirmed_at,processed_at,payment_link_id',
    order_code: `eq.${orderCode}`,
    payment_link_id: `eq.${paymentLinkId}`,
    limit: '1',
  });
  const response = await fetch(`${config.url}/rest/v1/payos_orders?${query.toString()}`, {
    headers: {
      apikey: config.key,
      Authorization: `Bearer ${config.key}`,
    },
  });
  const data = await safeJson(response);
  if (!response.ok) {
    throw new Error(data?.message || 'Không đọc được trạng thái PayOS.');
  }
  return Array.isArray(data) ? data[0] : null;
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
