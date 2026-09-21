export const PublicLookupService = {
  async byPhone(phone) { return request('/api/public/kiosk-lookup', { phone }); },
  async createRenewal({ renewalToken, months, returnUrl, promotionCode = null }) { return request('/api/public/renew-kiosk', { renewalToken, months, returnUrl, promotionCode }); },
  async previewPromotion({ renewalToken, months, code }) { return request('/api/public/evaluate-promotion', { renewalToken, months, code }); },
  async renewalStatus({ renewalToken, orderCode }) { return request('/api/public/renewal-status', { renewalToken, orderCode }); },
};
async function request(url, body) { const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); const data=await response.json().catch(()=>null); if(!response.ok||data?.success===false) throw new Error((data?.valid === false || ['P0001','PAYMENT_REVIEW_REQUIRED','PAYOS_STATUS_UNAVAILABLE','PAYOS_AWAITING_WEBHOOK','CHECKOUT_IN_PROGRESS','PAYMENT_ALREADY_COMPLETED'].includes(data?.code)) && data?.message ? data.message : publicMessage(response.status,data?.code)); return {data:data?.kiosks||data}; }
function publicMessage(status,code){if(status===401||String(code||'').includes('TOKEN'))return'Phiên gia hạn đã hết hạn. Vui lòng tra cứu lại Kiosk.';if(status===429)return'Bạn thao tác quá nhanh. Vui lòng thử lại sau ít phút.';return'Không thể xử lý yêu cầu lúc này. Vui lòng thử lại sau.'}
