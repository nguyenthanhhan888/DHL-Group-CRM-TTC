const {
  PAYOS_API_BASE_URL,
  PAYOS_CREATE_PAYMENT_PATH,
  callSupabaseRpc,
  createOrderCode,
  createPaymentExpiredAt,
  normalizePayosDescription,
  normalizePositiveAmount,
  normalizePurpose,
  parseJsonBody,
  requireEnv,
  sendError,
  signPaymentRequest,
} = require('./_utils');

module.exports = async function createPayosPaymentHandler(req, res) {
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
    const clientId = requireEnv('PAYOS_CLIENT_ID');
    const apiKey = requireEnv('PAYOS_API_KEY');
    const checksumKey = requireEnv('PAYOS_CHECKSUM_KEY');
    const payload = buildPaymentPayload(parsed.value, checksumKey);
    const accessToken = req.headers.authorization;

    await recordPayosOrder(payload, accessToken, { stage: 'reserved' });

    const payosResponse = await fetch(`${PAYOS_API_BASE_URL}${PAYOS_CREATE_PAYMENT_PATH}`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'x-client-id': clientId,
        'x-api-key': apiKey,
      },
      body: JSON.stringify(payload.request),
    });

    const payosData = await safeJson(payosResponse);
    if (!payosResponse.ok || payosData?.code !== '00') {
      return sendError(
        res,
        502,
        'PAYOS_CREATE_FAILED',
        payosData?.desc || 'Không tạo được link thanh toán PayOS.',
        payosData,
      );
    }

    await recordPayosOrder(payload, accessToken, payosData, {
      checkoutUrl: payosData?.data?.checkoutUrl || null,
      qrCode: payosData?.data?.qrCode || null,
      paymentLinkId: payosData?.data?.paymentLinkId || null,
    });

    return res.status(200).json({
      success: true,
      orderCode: payload.orderCode,
      checkoutUrl: payosData?.data?.checkoutUrl || null,
      qrCode: payosData?.data?.qrCode || null,
      paymentLinkId: payosData?.data?.paymentLinkId || null,
      expiresAt: payload.request.expiredAt,
      ...formatPayosTransferInfo(payosData?.data, payload),
    });
  } catch (error) {
    const status = error?.code === 'MISSING_ENV' ? 500 : 400;
    return sendError(
      res,
      status,
      error?.code || 'PAYOS_CREATE_ERROR',
      error?.message || 'Không tạo được thanh toán PayOS.',
    );
  }
};

async function recordPayosOrder(payload, accessToken, providerPayload, overrides = {}) {
  return callSupabaseRpc('record_payos_payment_link', {
      purpose_input: payload.purpose,
      payment_id_input: payload.paymentId,
      wallet_user_id_input: payload.walletUserId,
      order_code_input: payload.orderCode,
      amount_input: payload.amount,
      description_input: payload.description,
      checkout_url_input: overrides.checkoutUrl || null,
      qr_code_input: overrides.qrCode || null,
      payment_link_id_input: overrides.paymentLinkId || null,
      provider_payload_input: providerPayload,
    }, {
      accessToken,
    });
}

function formatPayosTransferInfo(data = {}, payload = {}) {
  return {
    accountName: data.accountName || data.account_name || null,
    accountNumber: data.accountNumber || data.account_number || null,
    bankName: data.bankName || data.bank_name || null,
    bin: data.bin || null,
    description: data.description || payload.description || null,
    amount: Number(data.amount || payload.amount || 0),
    currency: data.currency || 'VND',
  };
}

function buildPaymentPayload(body, checksumKey) {
  const purpose = normalizePurpose(body?.purpose);
  const amount = normalizePositiveAmount(body?.amount);
  const orderCode = body?.orderCode ? Number(body.orderCode) : createOrderCode();
  if (!Number.isSafeInteger(orderCode) || orderCode <= 0) {
    throw new Error('Mã đơn PayOS không hợp lệ.');
  }

  const returnUrl = normalizeUrl(body?.returnUrl || body?.return_url, 'returnUrl');
  const cancelUrl = normalizeUrl(body?.cancelUrl || body?.cancel_url, 'cancelUrl');
  const description = normalizePayosDescription(body?.description, orderCode);

  const paymentId = purpose === 'crm_payment' ? normalizePositiveInteger(body?.paymentId || body?.payment_id, 'paymentId') : null;
  const walletUserId = purpose === 'wallet_topup' ? normalizeUuid(body?.walletUserId || body?.wallet_user_id, 'walletUserId') : null;

  const request = {
    orderCode,
    amount,
    description,
    returnUrl,
    cancelUrl,
    expiredAt: createPaymentExpiredAt(),
  };
  request.signature = signPaymentRequest(request, checksumKey);

  return {
    amount,
    description,
    orderCode,
    paymentId,
    purpose,
    request,
    walletUserId,
  };
}

function normalizePositiveInteger(value, label) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    throw new Error(`${label} không hợp lệ.`);
  }
  return normalized;
}

function normalizeUuid(value, label) {
  const normalized = String(value || '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)) {
    throw new Error(`${label} không hợp lệ.`);
  }
  return normalized;
}

function normalizeUrl(value, label) {
  try {
    const url = new URL(String(value || '').trim());
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error();
    }
    return url.toString();
  } catch {
    throw new Error(`${label} phải là URL hợp lệ.`);
  }
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
