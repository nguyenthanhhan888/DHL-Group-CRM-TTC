const { PAYOS_API_BASE_URL, PAYOS_CREATE_PAYMENT_PATH, callSupabaseRpc, createOrderCode, normalizePayosDescription, parseJsonBody, requireEnv, sendError, signPaymentRequest } = require('../payos/_utils');
const { renewalNonceHash, verifyRenewalToken } = require('./_renewal-token');

const ALLOWED_MONTHS = new Set([1, 3, 6, 12]);

module.exports = async function publicRenewKiosk(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Chỉ hỗ trợ phương thức POST.'); }
  const parsed = parseJsonBody(req.body);
  if (!parsed.ok) return sendError(res, 400, 'INVALID_JSON', 'Nội dung JSON không hợp lệ.');
  try {
    const authorization = verifyRenewalToken(parsed.value.renewalToken);
    const months = Number(parsed.value.months);
    if (!ALLOWED_MONTHS.has(months)) return sendError(res, 400, 'INVALID_DURATION', 'Thời hạn gia hạn không được hỗ trợ.');
    const prepared = await callSupabaseRpc('prepare_public_kiosk_renewal', { kiosk_id_input: authorization.kid, months_input: months, nonce_hash_input: renewalNonceHash(authorization.nonce) }, { serviceRole: true });
    const payment = prepared?.payment;
    const amount = Number(payment?.total_amount);
    if (!payment?.id || !Number.isSafeInteger(amount) || amount <= 0) throw new Error('Giá gia hạn trên hệ thống không hợp lệ.');
    const orderCode = createOrderCode();
    const description = normalizePayosDescription(`DHL${payment.id}`, orderCode);
    const returnUrl = safeReturnUrl(parsed.value.returnUrl);
    const request = { orderCode, amount, description, returnUrl, cancelUrl: returnUrl };
    request.signature = signPaymentRequest(request, requireEnv('PAYOS_CHECKSUM_KEY'));
    await recordOrder(payment.id, request, { stage: 'reserved' });
    const providerResponse = await fetch(`${PAYOS_API_BASE_URL}${PAYOS_CREATE_PAYMENT_PATH}`, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'x-client-id': requireEnv('PAYOS_CLIENT_ID'), 'x-api-key': requireEnv('PAYOS_API_KEY') }, body: JSON.stringify(request) });
    const provider = await providerResponse.json().catch(() => null);
    if (!providerResponse.ok || provider?.code !== '00') throw new Error(provider?.desc || 'Không tạo được QR PayOS.');
    await recordOrder(payment.id, request, provider, provider.data || {});
    return res.status(200).json({ success: true, orderCode, amount, kiosk: prepared.kiosk_name, checkoutUrl: provider.data?.checkoutUrl || null, qrCode: provider.data?.qrCode || null, paymentLinkId: provider.data?.paymentLinkId || null, description: provider.data?.description || description, expiresAt: authorization.exp });
  } catch (error) { const status = ['INVALID_RENEWAL_TOKEN','TOKEN_EXPIRED','TOKEN_SCOPE_MISMATCH'].includes(error?.code) ? 401 : error?.code === 'MISSING_ENV' ? 500 : 400; return sendError(res, status, error?.code || 'PUBLIC_RENEWAL_FAILED', error?.message || 'Không thể tạo thanh toán gia hạn.'); }
};

async function recordOrder(paymentId, request, providerPayload, values = {}) { return callSupabaseRpc('record_public_renewal_payos_order', { payment_id_input: paymentId, order_code_input: request.orderCode, amount_input: request.amount, description_input: request.description, checkout_url_input: values.checkoutUrl || null, qr_code_input: values.qrCode || null, payment_link_id_input: values.paymentLinkId || null, provider_payload_input: providerPayload }, { serviceRole: true }); }
function safeReturnUrl(value) { const url = new URL(String(value || '')); if (!['http:','https:'].includes(url.protocol)) throw new Error('returnUrl không hợp lệ.'); const configured=process.env.PUBLIC_APP_URL||process.env.VERCEL_URL; if(configured){const allowed=new URL(configured.startsWith('http')?configured:`https://${configured}`);if(url.origin!==allowed.origin)throw new Error('returnUrl không thuộc website được phép.');} return url.toString(); }

module.exports.ALLOWED_MONTHS = ALLOWED_MONTHS;
