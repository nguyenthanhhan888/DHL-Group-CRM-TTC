const {
  callSupabaseRpc,
  parseJsonBody,
  requireEnv,
  safeCompareHex,
  sendError,
  signWebhookData,
} = require('./_utils');

module.exports = async function payosWebhookHandler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Chỉ hỗ trợ phương thức POST.');
  }

  const parsed = parseJsonBody(req.body);
  if (!parsed.ok) {
    logWebhook('PAYOS_WEBHOOK_REJECTED', { reason: 'INVALID_JSON' });
    return sendError(res, 400, 'INVALID_JSON', 'Nội dung JSON không hợp lệ.');
  }

  try {
    const checksumKey = requireEnv('PAYOS_CHECKSUM_KEY');
    const body = parsed.value;
    const data = body?.data;
    const signature = body?.signature;
    logWebhook('PAYOS_WEBHOOK_RECEIVED', { orderCode: safeOrderCode(data?.orderCode) });
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      logWebhook('PAYOS_WEBHOOK_REJECTED', { reason: 'MISSING_DATA' });
      return sendError(res, 400, 'INVALID_PAYOS_WEBHOOK', 'Webhook PayOS thiếu data.');
    }

    const expectedSignature = signWebhookData(data, checksumKey);
    if (!safeCompareHex(expectedSignature, signature)) {
      logWebhook('PAYOS_WEBHOOK_REJECTED', { reason: 'INVALID_SIGNATURE', orderCode: safeOrderCode(data.orderCode) });
      return sendError(res, 400, 'INVALID_SIGNATURE', 'Chữ ký PayOS không hợp lệ.');
    }
    logWebhook('PAYOS_SIGNATURE_VALID', { orderCode: safeOrderCode(data.orderCode) });

    const paidCode = data.code || body.code;
    if (body.success !== true || paidCode !== '00') {
      logWebhook('PAYOS_WEBHOOK_REJECTED', { reason: 'NOT_PAID_EVENT', orderCode: safeOrderCode(data.orderCode) });
      return res.status(200).json({ success: true, ignored: true });
    }

    const amount = Number(data.amount);
    const orderCode = Number(data.orderCode);
    if (!Number.isSafeInteger(orderCode) || orderCode <= 0 || !Number.isFinite(amount) || amount <= 0) {
      logWebhook('PAYOS_WEBHOOK_REJECTED', { reason: 'INVALID_PAYMENT_DATA', orderCode: safeOrderCode(orderCode) });
      return sendError(res, 400, 'INVALID_PAYOS_DATA', 'Dữ liệu thanh toán PayOS không hợp lệ.');
    }

    const result = await callSupabaseRpc('handle_payos_webhook', {
      order_code_input: orderCode,
      amount_input: amount,
      payment_link_id_input: data.paymentLinkId || null,
      reference_input: data.reference || null,
      provider_payload_input: body,
      signature_input: signature || null,
      event_key_input: buildEventKey(data),
    }, {
      serviceRole: true,
    });

    if (result?.already_processed) {
      logWebhook('PAYOS_WEBHOOK_DUPLICATE', { orderCode });
    } else if (result?.ignored) {
      logWebhook('PAYOS_WEBHOOK_REJECTED', { reason: 'ORDER_NOT_PROCESSABLE', orderCode });
    } else {
      logWebhook('PAYOS_ORDER_MATCHED', { orderCode });
      logWebhook('PAYOS_PAYMENT_COMPLETED', { orderCode });
      if (result?.order?.purpose === 'crm_payment') logWebhook('KIOSK_RENEWAL_COMPLETED', { orderCode });
    }

    return res.status(200).json({ success: true, result });
  } catch (error) {
    logWebhook('PAYOS_WEBHOOK_REJECTED', { reason: safeReason(error?.code), orderCode: safeOrderCode(parsed.value?.data?.orderCode) });
    const status = error?.code === 'MISSING_ENV' ? 500 : 400;
    return sendError(
      res,
      status,
      error?.code || 'PAYOS_WEBHOOK_ERROR',
      'Không xử lý được webhook PayOS.',
    );
  }
};

function buildEventKey(data) {
  return [
    'payos',
    data.orderCode || 'unknown-order',
    data.reference || data.paymentLinkId || 'paid',
  ].join(':');
}

function logWebhook(event, fields = {}) {
  console.info(event, { orderCode: safeOrderCode(fields.orderCode), reason: safeReason(fields.reason) });
}

function safeOrderCode(value) { const parsed=Number(value); return Number.isSafeInteger(parsed)&&parsed>0?parsed:null; }
function safeReason(value) { const reason=String(value||'').toUpperCase(); return /^[A-Z0-9_]{1,64}$/.test(reason)?reason:null; }
