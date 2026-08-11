const {
  PAYOS_API_BASE_URL,
  PAYOS_CREATE_PAYMENT_PATH,
  createOrderCode,
  getSupabaseServiceConfig,
  normalizePayosDescription,
  parseJsonBody,
  requireEnv,
  sendError,
  signPaymentRequest,
} = require('./_utils');

const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX = 12;
const rateBuckets = new Map();

module.exports = async function createRegistrationPaymentHandler(req, res) {
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
    enforceRateLimit(req);
    const clientId = requireEnv('PAYOS_CLIENT_ID');
    const apiKey = requireEnv('PAYOS_API_KEY');
    const checksumKey = requireEnv('PAYOS_CHECKSUM_KEY');
    const requestIds = normalizeRequestIds(parsed.value.requestIds || parsed.value.request_ids);
    const phone = normalizePhone(parsed.value.phone);
    const returnUrl = normalizeUrl(parsed.value.returnUrl || parsed.value.return_url || `${originFromRequest(req)}/#/register`);
    const cancelUrl = normalizeUrl(parsed.value.cancelUrl || parsed.value.cancel_url || `${originFromRequest(req)}/#/register`);

    const rows = await fetchRegistrationPayments(requestIds, phone);
    if (rows.length !== requestIds.length) {
      throw new Error('Không tìm thấy đầy đủ yêu cầu đăng ký để tạo PayOS.');
    }

    const payments = [];
    for (const requestId of requestIds) {
      const row = rows.find((item) => Number(item.id) === requestId);
      assertRegistrationCanCreatePayos(row, phone, requestId);

      const existingOrder = await fetchExistingPayosOrder(row.payment_id);
      if (existingOrder?.checkout_url || existingOrder?.qr_code) {
        payments.push(formatPaymentResult(row, existingOrder));
        continue;
      }

      const orderCode = createOrderCode();
      const amount = Number(row.payments.total_amount);
      const request = {
        orderCode,
        amount,
        description: normalizePayosDescription(`DHL${row.payment_id}`, orderCode),
        returnUrl,
        cancelUrl,
      };
      request.signature = signPaymentRequest(request, checksumKey);

      await upsertPayosOrder({
        paymentId: row.payment_id,
        orderCode,
        amount,
        description: request.description,
        providerPayload: { stage: 'reserved', requestId },
      });

      const payosResponse = await fetch(`${PAYOS_API_BASE_URL}${PAYOS_CREATE_PAYMENT_PATH}`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'x-client-id': clientId,
          'x-api-key': apiKey,
        },
        body: JSON.stringify(request),
      });

      const payosData = await safeJson(payosResponse);
      if (!payosResponse.ok || payosData?.code !== '00') {
        throw new Error(payosData?.desc || `Không tạo được PayOS cho yêu cầu #${requestId}.`);
      }

      const savedOrder = await upsertPayosOrder({
        paymentId: row.payment_id,
        orderCode,
        amount,
        description: request.description,
        checkoutUrl: payosData?.data?.checkoutUrl || null,
        qrCode: payosData?.data?.qrCode || null,
        paymentLinkId: payosData?.data?.paymentLinkId || null,
        providerPayload: payosData,
      });
      payments.push(formatPaymentResult(row, savedOrder));
    }

    return res.status(200).json({ success: true, payments });
  } catch (error) {
    const status = error?.status || (error?.code === 'MISSING_ENV' ? 500 : 400);
    return sendError(
      res,
      status,
      error?.code || 'REGISTRATION_PAYOS_ERROR',
      error?.message || 'Không tạo được thanh toán PayOS cho đăng ký.',
    );
  }
};

function enforceRateLimit(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const key = forwarded || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  const bucket = rateBuckets.get(key) || { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
  if (bucket.resetAt <= now) {
    bucket.count = 0;
    bucket.resetAt = now + RATE_LIMIT_WINDOW_MS;
  }
  bucket.count += 1;
  rateBuckets.set(key, bucket);
  if (bucket.count > RATE_LIMIT_MAX) {
    const error = new Error('Bạn thao tác quá nhanh. Vui lòng thử lại sau ít phút.');
    error.status = 429;
    throw error;
  }
}

function normalizeRequestIds(value) {
  const ids = (Array.isArray(value) ? value : [value])
    .map((item) => Number(item))
    .filter((item) => Number.isSafeInteger(item) && item > 0);
  if (!ids.length || ids.length > 20) {
    throw new Error('Danh sách yêu cầu đăng ký không hợp lệ.');
  }
  return Array.from(new Set(ids));
}

function normalizePhone(value) {
  const phone = String(value || '').replace(/[\s().-]/g, '').trim();
  if (!/^\+?\d{9,15}$/.test(phone)) {
    throw new Error('Số điện thoại xác nhận không hợp lệ.');
  }
  return phone;
}

function normalizeUrl(value) {
  const url = new URL(String(value || '').trim());
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('URL chuyển hướng PayOS không hợp lệ.');
  }
  return url.toString();
}

async function fetchRegistrationPayments(requestIds, phone) {
  const config = getSupabaseServiceConfig();
  const requestResponse = await fetch(
    `${config.url}/rest/v1/registration_requests?select=id,phone,status,payment_id,total_amount,customer_id,kiosk_id,months&id=in.(${requestIds.join(',')})`,
    {
      headers: {
        apikey: config.key,
        Authorization: `Bearer ${config.key}`,
      },
    },
  );
  const requests = await safeJson(requestResponse);
  if (!requestResponse.ok) {
    throw new Error(requests?.message || 'Không đọc được yêu cầu đăng ký.');
  }
  const rows = Array.isArray(requests) ? requests : [];
  await hydrateMissingPaymentIds(rows, phone);

  const paymentIds = rows
    .map((row) => Number(row.payment_id))
    .filter((id) => Number.isSafeInteger(id) && id > 0);
  if (!paymentIds.length) return rows.map((row) => ({ ...row, payments: null }));

  const paymentResponse = await fetch(
    `${config.url}/rest/v1/payments?select=id,total_amount,payment_status&id=in.(${Array.from(new Set(paymentIds)).join(',')})`,
    {
      headers: {
        apikey: config.key,
        Authorization: `Bearer ${config.key}`,
      },
    },
  );
  const payments = await safeJson(paymentResponse);
  if (!paymentResponse.ok) {
    throw new Error(payments?.message || 'Không đọc được thanh toán của yêu cầu đăng ký.');
  }
  const paymentMap = new Map((Array.isArray(payments) ? payments : []).map((payment) => [Number(payment.id), payment]));
  return rows.map((row) => ({
    ...row,
    payments: paymentMap.get(Number(row.payment_id)) || null,
  }));
}

async function hydrateMissingPaymentIds(rows, phone) {
  const missingRows = rows.filter((row) => !Number(row.payment_id));
  if (!missingRows.length) return;

  for (const row of missingRows) {
    const prepared = await prepareRegistrationPayment(row.id, phone);
    const preparedRequest = prepared?.request || {};
    const preparedPayment = prepared?.payment || {};
    row.customer_id = preparedRequest.customer_id || row.customer_id;
    row.kiosk_id = preparedRequest.kiosk_id || row.kiosk_id;
    row.payment_id = preparedRequest.payment_id || preparedPayment.id || row.payment_id;
    const payment = row.payment_id ? { id: row.payment_id } : await fetchPendingPaymentForRequest(row);
    if (payment?.id) {
      row.payment_id = payment.id;
    }
  }
}

async function prepareRegistrationPayment(requestId, phone) {
  const config = getSupabaseServiceConfig();
  const response = await fetch(`${config.url}/rest/v1/rpc/prepare_registration_payment_for_payos`, {
    method: 'POST',
    headers: {
      apikey: config.key,
      Authorization: `Bearer ${config.key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      request_id_input: Number(requestId),
      phone_input: phone,
    }),
  });
  const data = await safeJson(response);
  if (!response.ok) {
    throw new Error(data?.message || `Không chuẩn bị được thanh toán cho yêu cầu #${requestId}.`);
  }
  return data;
}

async function fetchPendingPaymentForRequest(row) {
  const config = getSupabaseServiceConfig();
  const query = new URLSearchParams({
    select: 'id,total_amount,payment_status',
    kiosk_id: `eq.${Number(row.kiosk_id)}`,
    customer_id: `eq.${Number(row.customer_id)}`,
    payment_status: 'ilike.pending',
    order: 'created_at.desc,id.desc',
    limit: '2',
  });
  query.append('transaction_type', 'eq.standard');
  if (Number(row.months)) {
    query.append('months', `eq.${Number(row.months)}`);
  }
  if (Number(row.total_amount)) {
    query.append('total_amount', `eq.${Number(row.total_amount)}`);
  }

  const response = await fetch(`${config.url}/rest/v1/payments?${query.toString()}`, {
    headers: {
      apikey: config.key,
      Authorization: `Bearer ${config.key}`,
    },
  });
  const data = await safeJson(response);
  if (!response.ok) {
    throw new Error(data?.message || 'Không dò được thanh toán Pending của yêu cầu đăng ký.');
  }
  if (!Array.isArray(data) || data.length !== 1) {
    throw new Error(`Không xác định được duy nhất thanh toán Pending của yêu cầu #${row.id}.`);
  }
  return data[0];
}

function assertRegistrationCanCreatePayos(row, phone, requestId) {
  if (!row) throw new Error(`Không tìm thấy yêu cầu #${requestId}.`);
  if (!['pending', 'approved'].includes(String(row.status || '').toLowerCase())) {
    throw new Error(`Yêu cầu #${requestId} không còn ở trạng thái có thể thanh toán.`);
  }
  if (normalizePhone(row.phone) !== phone) {
    const error = new Error(`Số điện thoại không khớp yêu cầu #${requestId}.`);
    error.status = 403;
    throw error;
  }
  if (!row.payment_id || !row.payments) {
    throw new Error(`Yêu cầu #${requestId} chưa có thanh toán Pending.`);
  }
  if (String(row.payments.payment_status || '').toLowerCase() !== 'pending') {
    throw new Error(`Thanh toán của yêu cầu #${requestId} không còn Pending.`);
  }
  const amount = Number(row.payments.total_amount || 0);
  if (!Number.isInteger(amount) || amount <= 0 || amount !== Number(row.total_amount || 0)) {
    throw new Error(`Số tiền thanh toán của yêu cầu #${requestId} không hợp lệ.`);
  }
}

async function fetchExistingPayosOrder(paymentId) {
  const config = getSupabaseServiceConfig();
  const response = await fetch(
    `${config.url}/rest/v1/payos_orders?select=*&purpose=eq.crm_payment&payment_id=eq.${Number(paymentId)}&status=eq.pending&order=created_at.desc&limit=1`,
    {
      headers: {
        apikey: config.key,
        Authorization: `Bearer ${config.key}`,
      },
    },
  );
  const data = await safeJson(response);
  if (!response.ok) {
    throw new Error(data?.message || 'Không đọc được PayOS order.');
  }
  return Array.isArray(data) ? data[0] : null;
}

async function upsertPayosOrder({
  paymentId,
  orderCode,
  amount,
  description,
  checkoutUrl = null,
  qrCode = null,
  paymentLinkId = null,
  providerPayload,
}) {
  const config = getSupabaseServiceConfig();
  const response = await fetch(`${config.url}/rest/v1/payos_orders?on_conflict=order_code&select=*`, {
    method: 'POST',
    headers: {
      apikey: config.key,
      Authorization: `Bearer ${config.key}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify({
      purpose: 'crm_payment',
      payment_id: Number(paymentId),
      order_code: Number(orderCode),
      amount: Number(amount),
      description,
      status: 'pending',
      checkout_url: checkoutUrl,
      qr_code: qrCode,
      payment_link_id: paymentLinkId,
      provider_payload: providerPayload,
    }),
  });
  const data = await safeJson(response);
  if (!response.ok) {
    throw new Error(data?.message || 'Không lưu được PayOS order.');
  }
  return Array.isArray(data) ? data[0] : data;
}

function formatPaymentResult(row, order) {
  const providerData = order.provider_payload?.data || {};
  return {
    requestId: Number(row.id),
    paymentId: Number(row.payment_id),
    amount: Number(row.payments?.total_amount || order.amount || 0),
    orderCode: order.order_code,
    checkoutUrl: order.checkout_url || null,
    qrCode: order.qr_code || null,
    paymentLinkId: order.payment_link_id || null,
    accountName: providerData.accountName || providerData.account_name || null,
    accountNumber: providerData.accountNumber || providerData.account_number || null,
    bankName: providerData.bankName || providerData.bank_name || null,
    bin: providerData.bin || null,
    description: providerData.description || order.description || null,
    currency: providerData.currency || 'VND',
  };
}

function originFromRequest(req) {
  const proto = req.headers['x-forwarded-proto'] || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000';
  return `${proto}://${host}`;
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
