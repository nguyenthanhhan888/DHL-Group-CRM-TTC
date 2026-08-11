const crypto = require('crypto');

const PAYOS_API_BASE_URL = 'https://api-merchant.payos.vn';
const PAYOS_CREATE_PAYMENT_PATH = '/v2/payment-requests';
const PAYOS_PAYMENT_TTL_SECONDS = 15 * 60;

function createPaymentExpiredAt(now = Date.now()) {
  return Math.floor(now / 1000) + PAYOS_PAYMENT_TTL_SECONDS;
}

function parseJsonBody(body) {
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    return { ok: true, value: body };
  }
  if (typeof body !== 'string') return { ok: false };
  try {
    const value = JSON.parse(body);
    return { ok: Boolean(value && typeof value === 'object' && !Array.isArray(value)), value };
  } catch {
    return { ok: false };
  }
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    const error = new Error(`Thiếu cấu hình ${name}.`);
    error.code = 'MISSING_ENV';
    throw error;
  }
  return value;
}

function getSupabaseServiceConfig() {
  return {
    url: requireEnv('SUPABASE_URL').replace(/\/+$/, ''),
    key: process.env.SUPABASE_SERVICE_ROLE_KEY || requireEnv('SUPABASE_SERVICE_KEY'),
  };
}

function getSupabaseUserConfig() {
  return {
    url: requireEnv('SUPABASE_URL').replace(/\/+$/, ''),
    key: requireEnv('SUPABASE_ANON_KEY'),
  };
}

function hmacSha256(data, checksumKey) {
  return crypto.createHmac('sha256', checksumKey).update(data).digest('hex');
}

function signPaymentRequest(payload, checksumKey) {
  const signatureData = [
    `amount=${payload.amount}`,
    `cancelUrl=${payload.cancelUrl}`,
    `description=${payload.description}`,
    `orderCode=${payload.orderCode}`,
    `returnUrl=${payload.returnUrl}`,
  ].join('&');
  return hmacSha256(signatureData, checksumKey);
}

function sortObject(value) {
  if (Array.isArray(value)) {
    return value.map(sortObject);
  }
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        result[key] = sortObject(value[key]);
        return result;
      }, {});
  }
  return value;
}

function serializePayosValue(value) {
  if (value === undefined) return undefined;
  if (value === null) return '';
  if (Array.isArray(value) || typeof value === 'object') {
    return JSON.stringify(sortObject(value));
  }
  return String(value);
}

function signWebhookData(data, checksumKey) {
  const signatureData = Object.keys(data || {})
    .sort()
    .map((key) => {
      const serialized = serializePayosValue(data[key]);
      return serialized === undefined ? null : `${key}=${serialized}`;
    })
    .filter(Boolean)
    .join('&');
  return hmacSha256(signatureData, checksumKey);
}

function safeCompareHex(left, right) {
  const normalizedLeft = String(left || '').trim().toLowerCase();
  const normalizedRight = String(right || '').trim().toLowerCase();
  if (!normalizedLeft || !normalizedRight) return false;
  if (!/^[0-9a-f]+$/.test(normalizedLeft) || !/^[0-9a-f]+$/.test(normalizedRight)) return false;
  if (normalizedLeft.length % 2 !== 0 || normalizedRight.length % 2 !== 0) return false;
  const leftBuffer = Buffer.from(normalizedLeft, 'hex');
  const rightBuffer = Buffer.from(normalizedRight, 'hex');
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizePositiveAmount(value) {
  const amount = Number(value);
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error('Số tiền PayOS phải là số nguyên dương.');
  }
  return amount;
}

function normalizePurpose(value) {
  const purpose = String(value || '').trim();
  if (!['crm_payment', 'wallet_topup'].includes(purpose)) {
    throw new Error('Mục đích PayOS không hợp lệ.');
  }
  return purpose;
}

function createOrderCode() {
  return Number(`${Date.now()}${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`);
}

function normalizePayosDescription(value, orderCode) {
  const source = String(value || `DHL${String(orderCode).slice(-6)}`)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
  return (source || `DHL${String(orderCode).slice(-6)}`).slice(0, 9);
}

async function callSupabaseRpc(functionName, payload, options = {}) {
  const useServiceRole = options.serviceRole === true;
  const config = useServiceRole ? getSupabaseServiceConfig() : getSupabaseUserConfig();
  const authorization = useServiceRole ? config.key : normalizeBearerToken(options.accessToken);
  const response = await fetch(`${config.url}/rest/v1/rpc/${functionName}`, {
    method: 'POST',
    headers: {
      apikey: config.key,
      Authorization: `Bearer ${authorization}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }
  if (!response.ok) {
    const error = new Error(data?.message || data?.error || 'Supabase RPC thất bại.');
    error.status = response.status;
    error.details = data;
    throw error;
  }
  return data;
}

function normalizeBearerToken(value) {
  const token = String(value || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    const error = new Error('Thiếu phiên đăng nhập để gọi Supabase RPC.');
    error.code = 'MISSING_AUTH_TOKEN';
    throw error;
  }
  return token;
}

function sendError(res, status, code, message, details) {
  return res.status(status).json({
    success: false,
    code,
    message,
    ...(details ? { details } : {}),
  });
}

module.exports = {
  PAYOS_API_BASE_URL,
  PAYOS_CREATE_PAYMENT_PATH,
  PAYOS_PAYMENT_TTL_SECONDS,
  callSupabaseRpc,
  createOrderCode,
  createPaymentExpiredAt,
  getSupabaseServiceConfig,
  getSupabaseUserConfig,
  normalizePayosDescription,
  normalizePositiveAmount,
  normalizePurpose,
  parseJsonBody,
  requireEnv,
  safeCompareHex,
  sendError,
  signPaymentRequest,
  signWebhookData,
};
