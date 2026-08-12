const { getSupabaseServiceConfig, parseJsonBody, sendError } = require('../payos/_utils');
const { verifyRenewalToken } = require('./_renewal-token');
const { publicRenewalPeriod } = require('./_renewal-period');

module.exports = async function renewalStatus(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Chỉ hỗ trợ POST.');
  const parsed = parseJsonBody(req.body);
  try {
    const auth = verifyRenewalToken(parsed.value?.renewalToken);
    const orderCode = Number(parsed.value?.orderCode);
    if (!Number.isSafeInteger(orderCode) || orderCode < 1) throw new Error('Mã đơn không hợp lệ.');
    const config = getSupabaseServiceConfig();
    const rows = await rest(config, `/rest/v1/payos_orders?select=status,amount,provider_payload,payments!inner(kiosk_id,months,start_date,end_date,payment_status,kiosks(facebook_name,end_date))&order_code=eq.${orderCode}&payments.kiosk_id=eq.${auth.kid}&limit=1`);
    const row = rows[0]; if (!row) return sendError(res, 404, 'ORDER_NOT_FOUND', 'Không tìm thấy thanh toán phù hợp.');
    const payment = row.payments;
    const completed = row.status === 'paid' && payment?.payment_status === 'completed';
    const snapshot = row.provider_payload?._renewal || {};
    const currentExpiry = snapshot.currentExpiry || (completed ? null : payment?.kiosks?.end_date) || null;
    const period = completed ? null : publicRenewalPeriod(currentExpiry, payment?.months);
    return res.status(200).json({ success: true, status: publicStatus(row.status, completed), amount: Number(row.amount), kiosk: payment?.kiosks?.facebook_name || 'Kiosk', months: Number(payment?.months || 0), currentExpiry, proposedExpiry: completed ? null : snapshot.proposedExpiry || period?.proposedExpiry || null, newExpiry: completed ? payment?.end_date || payment?.kiosks?.end_date || null : null });
  } catch (error) { return sendError(res, error?.code ? 401 : 400, error?.code || 'STATUS_FAILED', error?.message || 'Không kiểm tra được thanh toán.'); }
};
async function rest(config, path) { const response = await fetch(`${config.url}${path}`, { headers:{apikey:config.key,Authorization:`Bearer ${config.key}`} }); const data=await response.json().catch(()=>null); if(!response.ok) throw new Error(data?.message||'Supabase query thất bại.'); return data||[]; }
function publicStatus(orderStatus, completed) { if (completed) return 'paid'; const value=String(orderStatus||'').toLowerCase(); if(value==='expired')return'expired';if(value==='cancelled'||value==='canceled')return'cancelled';if(value==='failed')return'failed';return'pending'; }
