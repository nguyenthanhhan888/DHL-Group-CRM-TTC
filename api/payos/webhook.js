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
    return sendError(res, 400, 'INVALID_JSON', 'Nội dung JSON không hợp lệ.');
  }

  try {
    const checksumKey = requireEnv('PAYOS_CHECKSUM_KEY');
    const body = parsed.value;
    const data = body?.data;
    const signature = body?.signature;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return sendError(res, 400, 'INVALID_PAYOS_WEBHOOK', 'Webhook PayOS thiếu data.');
    }

    const expectedSignature = signWebhookData(data, checksumKey);
    if (!safeCompareHex(expectedSignature, signature)) {
      return sendError(res, 400, 'INVALID_SIGNATURE', 'Chữ ký PayOS không hợp lệ.');
    }

    const paidCode = data.code || body.code;
    if (body.success !== true || paidCode !== '00') {
      return res.status(200).json({ success: true, ignored: true });
    }

    const amount = Number(data.amount);
    const orderCode = Number(data.orderCode);
    if (!Number.isSafeInteger(orderCode) || orderCode <= 0 || !Number.isFinite(amount) || amount <= 0) {
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

    return res.status(200).json({ success: true, result });
  } catch (error) {
    const status = error?.code === 'MISSING_ENV' ? 500 : 400;
    return sendError(
      res,
      status,
      error?.code || 'PAYOS_WEBHOOK_ERROR',
      error?.message || 'Không xử lý được webhook PayOS.',
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
