const { getSupabaseServiceConfig, parseJsonBody, sendError } = require('../payos/_utils');

module.exports = async function evaluatePromotionHandler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Chỉ hỗ trợ phương thức POST.'); }
  const parsed = parseJsonBody(req.body);
  if (!parsed.ok) return sendError(res, 400, 'INVALID_JSON', 'Nội dung JSON không hợp lệ.');
  try {
    const code = String(parsed.value.code || '').trim().toUpperCase();
    const phone = String(parsed.value.phone || '').replace(/[\s().-]/g, '').trim();
    const items = normalizeItems(parsed.value.items);
    if (!code || code.length > 64) return sendError(res, 400, 'INVALID_PROMOTION_CODE', 'Mã giảm giá không hợp lệ.');
    const config = getSupabaseServiceConfig();
    const response = await fetch(`${config.url}/rest/v1/rpc/preview_registration_promotion`, { method: 'POST', headers: { apikey: config.key, Authorization: `Bearer ${config.key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ promotion_code_input: code, phone_input: phone, items_input: items }) });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error('Không thể kiểm tra mã lúc này.');
    return res.status(data?.valid ? 200 : 400).json(data);
  } catch (error) {
    return sendError(res, 400, 'PROMOTION_EVALUATION_FAILED', error?.message || 'Không thể kiểm tra mã lúc này.');
  }
};

function normalizeItems(value) {
  if (!Array.isArray(value) || !value.length || value.length > 20) throw new Error('Danh sách Kiosk không hợp lệ.');
  return value.map((item) => {
    const months = Number(item?.months); const price = Number(item?.pricePerMonth); const categoryId = Number(item?.categoryId); const businessTypeId = Number(item?.businessTypeId);
    if (![months, price, categoryId, businessTypeId].every(Number.isSafeInteger) || months < 1 || price < 0 || categoryId < 1 || businessTypeId < 1) throw new Error('Thông tin Kiosk không hợp lệ.');
    return { months, pricePerMonth: price, totalAmount: months * price, categoryId, businessTypeId };
  });
}
