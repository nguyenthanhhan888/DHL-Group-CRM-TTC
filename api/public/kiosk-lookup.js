const { callSupabaseRpc, getSupabaseServiceConfig, parseJsonBody, sendError } = require('../payos/_utils');
const { issueRenewalToken, renewalNonceHash, verifyRenewalToken } = require('./_renewal-token');

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
    const kiosks=[]; for(const row of rows){let renewalToken=null;try{renewalToken=issueRenewalToken({kioskId:row.id});const claims=verifyRenewalToken(renewalToken);await callSupabaseRpc('register_public_renewal_authorization',{kiosk_id_input:row.id,nonce_hash_input:renewalNonceHash(claims.nonce),expires_at_input:new Date(claims.exp*1000).toISOString()},{serviceRole:true});}catch(renewalError){renewalToken=null;console.error('Public renewal unavailable during lookup:',renewalError?.code||renewalError?.message);}kiosks.push({
      kiosk: row.facebook_name || 'Kiosk', startDate: row.start_date, endDate: row.end_date, status: row.status,
      category: row.categories?.name || null, businessType: row.business_types?.name || null,
      pricePerMonth: Number(row.business_types?.price_per_month || 0), renewalToken, renewalAvailable:Boolean(renewalToken),
    });} return res.status(200).json({success:true,kiosks});
  } catch (error) { console.error('Public Kiosk lookup failed:',error?.code||error?.message); return sendError(res, 400, 'LOOKUP_FAILED', 'Không thể tra cứu lúc này. Vui lòng thử lại sau.'); }
};

async function rest(config, path) { const response = await fetch(`${config.url}${path}`, { headers: { apikey: config.key, Authorization: `Bearer ${config.key}` } }); const data = await response.json().catch(() => null); if (!response.ok) throw new Error(data?.message || 'Supabase query thất bại.'); return data || []; }
