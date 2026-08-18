const { PAYOS_API_BASE_URL, PAYOS_CREATE_PAYMENT_PATH, callSupabaseRpc, createOrderCode, createPaymentExpiredAt, normalizePayosDescription, parseJsonBody, requireEnv, sendError, signPaymentRequest } = require('../payos/_utils');
const { renewalNonceHash, verifyRenewalToken } = require('./_renewal-token');
const { publicRenewalPeriod } = require('./_renewal-period');

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
    const kioskPeriod = await readKioskPeriod(authorization.kid);
    const period = publicRenewalPeriod(kioskPeriod.currentExpiry, months);
    const existingOrder = await readActiveOrder(payment.id);
    if (existingOrder) return res.status(200).json(formatRenewalResponse({ order: existingOrder, payment, kiosk: prepared.kiosk_name, months, kioskPeriod, period, reused: true }));
    const orderCode = createOrderCode();
    const description = normalizePayosDescription(`DHL${payment.id}`, orderCode);
    const returnUrl = safeReturnUrl(parsed.value.returnUrl);
    const request = { orderCode, amount, description, returnUrl, cancelUrl: returnUrl, expiredAt: createPaymentExpiredAt() };
    request.signature = signPaymentRequest(request, requireEnv('PAYOS_CHECKSUM_KEY'));
    await recordOrder(payment.id, request, { stage: 'reserved', expiresAt: request.expiredAt });
    const providerResponse = await fetch(`${PAYOS_API_BASE_URL}${PAYOS_CREATE_PAYMENT_PATH}`, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'x-client-id': requireEnv('PAYOS_CLIENT_ID'), 'x-api-key': requireEnv('PAYOS_API_KEY') }, body: JSON.stringify(request) });
    const provider = await providerResponse.json().catch(() => null);
    if (!providerResponse.ok || provider?.code !== '00') throw new Error(provider?.desc || 'Không tạo được QR PayOS.');
    const providerData = provider.data || {};
    const renewalSnapshot = { months, currentExpiry: kioskPeriod.currentExpiry, proposedExpiry: period?.proposedExpiry || null };
    await recordOrder(payment.id, request, { ...provider, expiresAt: request.expiredAt, _renewal: renewalSnapshot }, providerData);
    return res.status(200).json({ success: true, status: 'pending', orderCode, amount, kiosk: prepared.kiosk_name, ...renewalSnapshot, checkoutUrl: providerData.checkoutUrl || null, qr: normalizeQr(providerData.qrCode), paymentLinkId: providerData.paymentLinkId || null, description: providerData.description || description, transfer: normalizeTransfer(providerData, amount, providerData.description || description), expiresAt: request.expiredAt });
  } catch (error) { const status = ['INVALID_RENEWAL_TOKEN','TOKEN_EXPIRED','TOKEN_SCOPE_MISMATCH'].includes(error?.code) ? 401 : error?.code === 'MISSING_ENV' ? 500 : 400; logSafeRenewalError(error); return sendError(res, status, error?.code || 'PUBLIC_RENEWAL_FAILED', publicRenewalError(error)); }
};

function publicRenewalError(error) { if(['INVALID_RENEWAL_TOKEN','TOKEN_EXPIRED','TOKEN_SCOPE_MISMATCH'].includes(error?.code))return error.message; if(error?.code==='23505')return'Bạn đang có một mã thanh toán còn hiệu lực.'; if(error?.code==='MISSING_ENV')return'Hệ thống thanh toán chưa được cấu hình đầy đủ.'; return'Không thể tạo thanh toán gia hạn. Vui lòng thử lại hoặc liên hệ hỗ trợ.'; }
function logSafeRenewalError(error) { console.error('PUBLIC_RENEWAL_FAILED',{code:/^[A-Z0-9_]{1,64}$/i.test(String(error?.code||''))?error.code:null,status:Number.isInteger(error?.status)?error.status:null}); }

async function recordOrder(paymentId, request, providerPayload, values = {}) { return callSupabaseRpc('record_public_renewal_payos_order', { payment_id_input: paymentId, order_code_input: request.orderCode, amount_input: request.amount, description_input: request.description, checkout_url_input: values.checkoutUrl || null, qr_code_input: values.qrCode || null, payment_link_id_input: values.paymentLinkId || null, provider_payload_input: providerPayload }, { serviceRole: true }); }
async function readKioskPeriod(kioskId) { const { getSupabaseServiceConfig } = require('../payos/_utils'); const config = getSupabaseServiceConfig(); const response = await fetch(`${config.url}/rest/v1/kiosks?select=end_date&id=eq.${kioskId}&limit=1`, { headers: { apikey: config.key, Authorization: `Bearer ${config.key}` } }); const rows = await response.json().catch(() => null); if (!response.ok) throw new Error(rows?.message || 'Không đọc được kỳ hạn Kiosk.'); return { currentExpiry: rows?.[0]?.end_date || null }; }
async function readActiveOrder(paymentId) { const { getSupabaseServiceConfig } = require('../payos/_utils'); const config=getSupabaseServiceConfig(); const query=new URLSearchParams({select:'*',purpose:'eq.crm_payment',payment_id:`eq.${paymentId}`,status:'eq.pending',active_slot:'is.true',expires_at:`gt.${new Date().toISOString()}`,order:'created_at.desc',limit:'1'}); const response=await fetch(`${config.url}/rest/v1/payos_orders?${query}`,{headers:{apikey:config.key,Authorization:`Bearer ${config.key}`}}); const rows=await response.json().catch(()=>null); if(!response.ok)throw new Error(rows?.message||'Không đọc được mã PayOS hiện tại.'); return rows?.[0]||null; }
function formatRenewalResponse({order,payment,kiosk,months,kioskPeriod,period,reused}) { const provider=order.provider_payload?.data||{}; const description=provider.description||order.description; return {success:true,status:'pending',reused,message:reused?'Bạn đang có một mã thanh toán còn hiệu lực.':null,orderCode:Number(order.order_code),amount:Number(payment.total_amount),kiosk,months,currentExpiry:kioskPeriod.currentExpiry,proposedExpiry:period?.proposedExpiry||null,checkoutUrl:order.checkout_url||null,qr:normalizeQr(order.qr_code),paymentLinkId:order.payment_link_id||null,description,transfer:normalizeTransfer(provider,payment.total_amount,description),expiresAt:order.expires_at?Math.floor(Date.parse(order.expires_at)/1000):null}; }
function normalizeQr(value) { const normalized = String(value || '').trim(); if (!normalized) return null; return { format: /^(https?:|data:image\/)/i.test(normalized) ? 'image' : 'payload', value: normalized }; }
function normalizeTransfer(data, amount, description) { const value={bankName:data.bankName||data.bank_name||null,bin:data.bin||null,accountNumber:data.accountNumber||data.account_number||null,accountName:data.accountName||data.account_name||null,amount:Number(amount),description:description||null}; return value.accountNumber||value.accountName||value.bankName||value.bin?value:null; }
function safeReturnUrl(value) { const url = new URL(String(value || '')); if (!['http:','https:'].includes(url.protocol)) throw new Error('returnUrl không hợp lệ.'); const configured=process.env.APP_BASE_URL||process.env.VERCEL_URL; if(configured){const allowed=new URL(configured.startsWith('http')?configured:`https://${configured}`);if(url.origin!==allowed.origin)throw new Error('returnUrl không thuộc website được phép.');} return url.toString(); }

module.exports.ALLOWED_MONTHS = ALLOWED_MONTHS;
module.exports.normalizeQr = normalizeQr;
module.exports.normalizeTransfer = normalizeTransfer;
