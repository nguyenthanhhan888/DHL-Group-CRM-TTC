const { callSupabaseRpc, getSupabaseServiceConfig, parseJsonBody, sendError } = require('../payos/_utils');
const { issueRenewalToken, renewalNonceHash, verifyRenewalToken } = require('./_renewal-token');
const { publicRenewalPeriod } = require('./_renewal-period');

const AUTO_RENEWAL_STATUSES = new Set(['active', 'warning', 'expired']);

module.exports = async function publicKioskLookup(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Chỉ hỗ trợ phương thức POST.'); }
  const parsed = parseJsonBody(req.body);
  const phone = String(parsed.value?.phone || '').replace(/[\s().-]/g, '');
  if (!parsed.ok || !/^\+?\d{9,15}$/.test(phone)) return sendError(res, 400, 'INVALID_PHONE', 'Số điện thoại không hợp lệ.');
  try {
    const config = getSupabaseServiceConfig();
    const customers = await rest(config, `/rest/v1/customers?select=id&phone=eq.${encodeURIComponent(phone)}&limit=1`);
    if (!customers[0]?.id) return res.status(200).json({ success: true, kiosks: [] });
    const rows = await rest(config, `/rest/v1/kiosks?select=id,facebook_name,start_date,end_date,status,categories(name),business_types(name,price_per_month)&customer_id=eq.${customers[0].id}&order=facebook_name.asc`);
    const kiosks=[]; for(const row of rows){const status=String(row.status||'').trim().toLowerCase();const pricePerMonth=Number(row.business_types?.price_per_month);let renewalToken=null;let renewalBlockedReason=null;if(status==='pending'){renewalBlockedReason='PENDING_APPROVAL';}else if(!Number.isSafeInteger(pricePerMonth)||pricePerMonth<=0){renewalBlockedReason='INVALID_PRICE';logRenewalDiagnostic('INVALID_KIOSK_PRICE');}else if(!AUTO_RENEWAL_STATUSES.has(status)){renewalBlockedReason='RENEWAL_CONFIG_UNAVAILABLE';}else{try{renewalToken=issueRenewalToken({kioskId:row.id});}catch(error){renewalBlockedReason='RENEWAL_CONFIG_UNAVAILABLE';logRenewalDiagnostic(error?.code==='MISSING_RENEWAL_SECRET'?'MISSING_RENEWAL_SECRET':'TOKEN_CREATE_FAILED');}if(renewalToken){try{const claims=verifyRenewalToken(renewalToken);await callSupabaseRpc('register_public_renewal_authorization',{kiosk_id_input:row.id,nonce_hash_input:renewalNonceHash(claims.nonce),expires_at_input:new Date(claims.exp*1000).toISOString()},{serviceRole:true});}catch(error){renewalToken=null;renewalBlockedReason='RENEWAL_CONFIG_UNAVAILABLE';logRenewalDiagnostic('AUTHORIZATION_RPC_FAILED',error);}}}kiosks.push({
      kiosk: row.facebook_name || 'Kiosk', startDate: row.start_date, endDate: row.end_date, status: row.status,
      category: row.categories?.name || null, businessType: row.business_types?.name || null,
      pricePerMonth: Number.isFinite(pricePerMonth)?pricePerMonth:null, renewalPeriods: renewalPeriodOptions(row.end_date), renewalButtonVisible:true, renewalToken, renewalAvailable:Boolean(renewalToken), renewalBlockedReason,
    });} return res.status(200).json({success:true,kiosks});
  } catch (error) { console.error('Public Kiosk lookup failed:',error?.code||error?.message); return sendError(res, 400, 'LOOKUP_FAILED', 'Không thể tra cứu lúc này. Vui lòng thử lại sau.'); }
};

async function rest(config, path) { const response = await fetch(`${config.url}${path}`, { headers: { apikey: config.key, Authorization: `Bearer ${config.key}` } }); const data = await response.json().catch(() => null); if (!response.ok) throw new Error(data?.message || 'Supabase query thất bại.'); return data || []; }
function logRenewalDiagnostic(category,error) { const allowed=new Set(['MISSING_RENEWAL_SECRET','TOKEN_CREATE_FAILED','AUTHORIZATION_RPC_FAILED','INVALID_KIOSK_PRICE','UNKNOWN_RENEWAL_ERROR']);const safeCategory=allowed.has(category)?category:'UNKNOWN_RENEWAL_ERROR';if(safeCategory==='AUTHORIZATION_RPC_FAILED')console.error('Public renewal unavailable:',safeCategory,safeAuthorizationRpcError(error));else console.error('Public renewal unavailable:',safeCategory); }
function safeAuthorizationRpcError(error) { return {code:safeErrorField(error?.code),message:safeErrorField(error?.message),details:safeErrorField(error?.details),hint:safeErrorField(error?.hint)}; }
function safeErrorField(value) { if(value==null)return null;const text=typeof value==='string'?value:JSON.stringify(value);const secrets=[process.env.SUPABASE_SERVICE_ROLE_KEY,process.env.SUPABASE_SERVICE_KEY,process.env.PUBLIC_RENEWAL_TOKEN_SECRET].filter(Boolean);if(secrets.some(secret=>text.includes(secret)))return'[REDACTED]';if(/(?:bearer\s+|nonce|renewal.?token|phone|customer)/i.test(text))return'[REDACTED]';return text.slice(0,500); }
function renewalPeriodOptions(currentExpiry) { return Object.fromEntries([1,3,6,12].map(months => [months, publicRenewalPeriod(currentExpiry,months)])); }

module.exports.safeAuthorizationRpcError = safeAuthorizationRpcError;
