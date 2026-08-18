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

    const display = await fetchRegistrationDisplay(order.payment_id);
    return res.status(200).json({
      success: true,
      orderCode: Number(order.order_code),
      status: authoritativeStatus(order.status, display.paymentStatus),
      amount: Number(order.amount || 0),
      confirmedAt: order.confirmed_at || null,
      processedAt: order.processed_at || null,
      ...display,
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
  const response = await fetch(`${config.url}/rest/v1/payos_orders?select=order_code,status,amount,confirmed_at,processed_at,payment_link_id,payment_id&order_code=eq.${orderCode}&limit=1`, {
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
    select: 'order_code,status,amount,confirmed_at,processed_at,payment_link_id,payment_id',
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

async function fetchRegistrationDisplay(paymentId) {
  if (!paymentId) return {};
  const config = getSupabaseServiceConfig();
  const query = new URLSearchParams({
    select: 'payment_status,total_amount,start_date,end_date,registration_batch_id,kiosks(id,facebook_name,status,start_date,end_date,categories(name),business_types(name))',
    id: `eq.${Number(paymentId)}`,
    limit: '1',
  });
  const response = await fetch(`${config.url}/rest/v1/payments?${query}`, {
    headers: { apikey: config.key, Authorization: `Bearer ${config.key}` },
  });
  const rows = await safeJson(response);
  if (!response.ok || !Array.isArray(rows) || !rows[0]) return {};
  const payment = rows[0];
  const kiosk = payment.kiosks || {};
  if (payment.registration_batch_id) {
    const itemQuery = new URLSearchParams({
      select: 'kiosk_id,start_date,end_date,registration_batches(status),kiosks(id,facebook_name,status,categories(name),business_types(name))',
      batch_id: `eq.${Number(payment.registration_batch_id)}`,
      order: 'id.asc',
    });
    const itemResponse = await fetch(`${config.url}/rest/v1/registration_batch_items?${itemQuery}`, {
      headers: { apikey: config.key, Authorization: `Bearer ${config.key}` },
    });
    const items = await safeJson(itemResponse);
    if (!itemResponse.ok || !Array.isArray(items)) return { paymentStatus: payment.payment_status || null };
    return {
      paymentStatus: payment.payment_status || null,
      registrationStatus: items[0]?.registration_batches?.status || 'pending',
      kiosks: items.map((item) => ({
        id: item.kiosks?.id || item.kiosk_id,
        name: item.kiosks?.facebook_name || 'Kiosk',
        category: item.kiosks?.categories?.name || null,
        businessType: item.kiosks?.business_types?.name || null,
        startDate: item.start_date || null,
        endDate: item.end_date || null,
        status: item.kiosks?.status || null,
      })),
    };
  }
  return {
    paymentStatus: payment.payment_status || null,
    kiosk: kiosk.facebook_name || null,
    category: kiosk.categories?.name || null,
    businessType: kiosk.business_types?.name || null,
    startDate: payment.start_date || kiosk.start_date || null,
    endDate: payment.end_date || kiosk.end_date || null,
    kioskStatus: kiosk.status || null,
    kiosks: kiosk.id ? [{ id: kiosk.id, name: kiosk.facebook_name || 'Kiosk', category: kiosk.categories?.name || null, businessType: kiosk.business_types?.name || null, startDate: payment.start_date || kiosk.start_date || null, endDate: payment.end_date || kiosk.end_date || null, status: kiosk.status || null }] : [],
  };
}

function authoritativeStatus(orderStatus, paymentStatus) {
  const order = String(orderStatus || '').toLowerCase();
  const payment = String(paymentStatus || '').toLowerCase();
  if (order === 'paid' && payment === 'completed') return 'paid';
  if (['cancelled', 'canceled', 'failed', 'expired'].includes(order)) return order;
  return 'pending';
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
