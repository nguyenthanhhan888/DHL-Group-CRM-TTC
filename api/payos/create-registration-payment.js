const {
  PAYOS_API_BASE_URL, PAYOS_CREATE_PAYMENT_PATH, createOrderCode, createPaymentExpiredAt,
  getSupabaseServiceConfig, normalizePayosDescription, parseJsonBody, requireEnv,
  sendError, signPaymentRequest,
} = require('./_utils');

const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX = 12;
const rateBuckets = new Map();

module.exports = async function createRegistrationPaymentHandler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Chỉ hỗ trợ phương thức POST.'); }
  const parsed = parseJsonBody(req.body);
  if (!parsed.ok) return sendError(res, 400, 'INVALID_JSON', 'Nội dung JSON không hợp lệ.');
  try {
    enforceRateLimit(req);
    const requestIds = normalizeRequestIds(parsed.value.requestIds || parsed.value.request_ids);
    const phone = normalizePhone(parsed.value.phone);
    const returnUrl = normalizeUrl(parsed.value.returnUrl || parsed.value.return_url || `${originFromRequest(req)}/#/register`);
    const cancelUrl = normalizeUrl(parsed.value.cancelUrl || parsed.value.cancel_url || returnUrl);
    const prepared = await prepareBatch(requestIds, phone);
    const payment = prepared?.payment;
    const batch = prepared?.batch;
    const amount = Number(payment?.total_amount);
    if (!batch?.id || !payment?.id || !Number.isSafeInteger(amount) || amount <= 0 || amount !== Number(batch.total_amount)) throw new Error('Tổng tiền lô đăng ký không hợp lệ.');

    const existingOrder = await fetchExistingPayosOrder(payment.id);
    if (existingOrder) {
      const readyOrder = existingOrder.checkout_url ? existingOrder : await waitForCheckout(payment.id, existingOrder.order_code);
      if (!readyOrder?.checkout_url) { const error = new Error('Link PayOS đang được tạo.'); error.code = 'CHECKOUT_IN_PROGRESS'; throw error; }
      return res.status(200).json({ success: true, batch: formatBatch(prepared), payment: formatPayment(readyOrder, amount, true) });
    }

    const orderCode = createOrderCode();
    const request = { orderCode, amount, description: normalizePayosDescription(`DHL${payment.id}`, orderCode), returnUrl, cancelUrl, expiredAt: createPaymentExpiredAt() };
    request.signature = signPaymentRequest(request, requireEnv('PAYOS_CHECKSUM_KEY'));
    await recordOrder(payment.id, request, { stage: 'reserved', batchId: batch.id, expiresAt: request.expiredAt });
    const response = await fetch(`${PAYOS_API_BASE_URL}${PAYOS_CREATE_PAYMENT_PATH}`, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'x-client-id': requireEnv('PAYOS_CLIENT_ID'), 'x-api-key': requireEnv('PAYOS_API_KEY') }, body: JSON.stringify(request) });
    const provider = await safeJson(response);
    if (!response.ok || provider?.code !== '00') throw new Error(provider?.desc || 'Không tạo được link PayOS cho lô đăng ký.');
    const data = provider.data || {};
    const saved = await recordOrder(payment.id, request, { ...provider, batchId: batch.id, expiresAt: request.expiredAt }, data);
    return res.status(200).json({ success: true, batch: formatBatch(prepared), payment: formatPayment(saved, amount, false, request.expiredAt) });
  } catch (error) {
    const status = error?.status || (error?.code === 'MISSING_ENV' ? 500 : 400);
    console.error('REGISTRATION_BATCH_PAYOS_FAILED', {
      code: safeDiagnostic(error?.code),
      message: safeDiagnostic(error?.message),
      details: safeDiagnostic(error?.details),
      hint: safeDiagnostic(error?.hint),
      status,
    });
    return sendError(res, status, error?.code || 'REGISTRATION_BATCH_PAYOS_ERROR', publicRegistrationError(error));
  }
};

async function prepareBatch(requestIds, phone) {
  const config = getSupabaseServiceConfig();
  const response = await fetch(`${config.url}/rest/v1/rpc/prepare_registration_batch_for_payos`, { method: 'POST', headers: { apikey: config.key, Authorization: `Bearer ${config.key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ request_ids_input: requestIds, phone_input: phone }) });
  const data = await safeJson(response);
  if (!response.ok) {
    const error = new Error(data?.message || 'Không chuẩn bị được lô đăng ký.');
    error.code = data?.code;
    error.details = data?.details;
    error.hint = data?.hint;
    throw error;
  }
  return data;
}

async function fetchExistingPayosOrder(paymentId) {
  const config = getSupabaseServiceConfig();
  const query = new URLSearchParams({ select: '*', purpose: 'eq.crm_payment', payment_id: `eq.${Number(paymentId)}`, status: 'eq.pending', active_slot: 'is.true', expires_at: `gt.${new Date().toISOString()}`, order: 'created_at.desc', limit: '1' });
  const response = await fetch(`${config.url}/rest/v1/payos_orders?${query}`, { headers: { apikey: config.key, Authorization: `Bearer ${config.key}` } });
  const rows = await safeJson(response);
  if (!response.ok) throw new Error(rows?.message || 'Không đọc được PayOS order hiện tại.');
  return rows?.[0] || null;
}

async function waitForCheckout(paymentId, orderCode) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const order = await fetchExistingPayosOrder(paymentId);
    if (!order || Number(order.order_code) !== Number(orderCode)) return order;
    if (order.checkout_url) return order;
  }
  return null;
}

async function recordOrder(paymentId, request, providerPayload, values = {}) {
  const config = getSupabaseServiceConfig();
  const response = await fetch(`${config.url}/rest/v1/rpc/record_registration_payos_order`, { method: 'POST', headers: { apikey: config.key, Authorization: `Bearer ${config.key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ payment_id_input: paymentId, order_code_input: request.orderCode, amount_input: request.amount, description_input: request.description, checkout_url_input: values.checkoutUrl || null, qr_code_input: values.qrCode || null, payment_link_id_input: values.paymentLinkId || null, provider_payload_input: providerPayload }) });
  const data = await safeJson(response);
  if (!response.ok) throw new Error(data?.message || 'Không lưu được PayOS order của lô đăng ký.');
  return Array.isArray(data) ? data[0] : data;
}

function formatBatch(prepared) { return { id: Number(prepared.batch.id), status: prepared.batch.status, amount: Number(prepared.batch.total_amount), kiosks: prepared.items || [], reused: Boolean(prepared.reused) }; }
function formatPayment(order, amount, reused, expiresAt = null) { return { paymentId: Number(order.payment_id), amount, orderCode: Number(order.order_code), checkoutUrl: order.checkout_url || null, paymentLinkId: order.payment_link_id || null, expiresAt: expiresAt || toUnixSeconds(order.expires_at), reused }; }
function normalizeRequestIds(value) { const ids = (Array.isArray(value) ? value : [value]).map(Number).filter((id) => Number.isSafeInteger(id) && id > 0); if (!ids.length || ids.length > 20 || new Set(ids).size !== ids.length) throw new Error('Danh sách yêu cầu đăng ký không hợp lệ.'); return ids; }
function normalizePhone(value) { const phone = String(value || '').replace(/[\s().-]/g, '').trim(); if (!/^\+?\d{9,15}$/.test(phone)) throw new Error('Số điện thoại xác nhận không hợp lệ.'); return phone; }
function normalizeUrl(value) { const url = new URL(String(value || '').trim()); if (!['http:', 'https:'].includes(url.protocol)) throw new Error('URL chuyển hướng PayOS không hợp lệ.'); return url.toString(); }
function enforceRateLimit(req) { const key = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown'; const now = Date.now(); const bucket = rateBuckets.get(key) || { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS }; if (bucket.resetAt <= now) { bucket.count = 0; bucket.resetAt = now + RATE_LIMIT_WINDOW_MS; } bucket.count += 1; rateBuckets.set(key, bucket); if (bucket.count > RATE_LIMIT_MAX) { const error = new Error('Bạn thao tác quá nhanh.'); error.status = 429; throw error; } }
function publicRegistrationError(error) { if (error?.status === 429) return 'Bạn thao tác quá nhanh. Vui lòng thử lại sau ít phút.'; if (error?.code === '42501') return 'Số điện thoại không khớp lô đăng ký.'; if (error?.code === 'CHECKOUT_IN_PROGRESS' || error?.code === '23505') return 'Link thanh toán đang được tạo. Vui lòng bấm Thanh toán lại sau vài giây.'; if (error?.code === 'MISSING_ENV') return 'Hệ thống thanh toán chưa được cấu hình đầy đủ.'; return 'Không tạo được thanh toán PayOS cho lô đăng ký. Vui lòng thử lại hoặc liên hệ hỗ trợ.'; }
function originFromRequest(req) { return `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000'}`; }
function toUnixSeconds(value) { const time = Date.parse(value || ''); return Number.isFinite(time) ? Math.floor(time / 1000) : null; }
async function safeJson(response) { return response.json().catch(() => null); }
function safeDiagnostic(value) {
  const text = String(value || '').slice(0, 500);
  if (!text) return null;
  return text
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[REDACTED_JWT]')
    .replace(/\+?\d{9,}/g, '[REDACTED_NUMBER]');
}
