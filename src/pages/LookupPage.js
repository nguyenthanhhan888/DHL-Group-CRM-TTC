import { PublicLookupService } from '../services/PublicLookupService.js';
import { isValidPhone } from '../utils/formValidation.js';
import { formatCurrency } from '../utils/currency.js';
import { escapeHtml } from '../utils/html.js';
import { PublicContactLinks, PublicSupport } from '../components/PublicSupport.js';

let lookupRows = [];
const ALLOWED_PUBLIC_MONTHS = new Set([1, 3, 6, 12]);

export function LookupPage() {
  return `<section class="portal-page narrow public-lookup-page"><div class="portal-page-heading"><span>Tra cứu công khai</span><h1>Tra cứu Kiosk</h1><p>Nhập số điện thoại đã dùng khi đăng ký để xem thông tin Kiosk an toàn.</p></div><form id="lookup-form" class="lookup-form" novalidate><label class="form-group"><span>Số điện thoại đã đăng ký</span><input id="lookup-phone" class="form-control" type="tel" inputmode="tel" autocomplete="tel" required></label><button class="btn-primary" type="submit">Tra cứu</button></form><div id="lookup-message" class="form-error hidden" role="alert"></div><div id="lookup-results" class="lookup-results" aria-live="polite"></div>${PublicSupport()}</section>`;
}

LookupPage.afterRender = async function afterRender() {
  lookupRows = [];
  document.getElementById('lookup-form')?.addEventListener('submit', lookup);
  document.getElementById('lookup-results')?.addEventListener('click', handleResultClick);
  const prefillPhone = sessionStorage.getItem('lookup-prefill-phone') || '';
  sessionStorage.removeItem('lookup-prefill-phone');
  const phone = document.getElementById('lookup-phone');
  if (phone && prefillPhone) phone.value = prefillPhone;
  await handleRenewalReturn();
};

async function lookup(event) {
  event.preventDefault();
  const phone = document.getElementById('lookup-phone');
  const message = document.getElementById('lookup-message');
  const results = document.getElementById('lookup-results');
  const button = event.currentTarget.querySelector('button');
  message.classList.add('hidden'); results.innerHTML = '';
  if (!isValidPhone(phone.value)) { show(message, 'Số điện thoại phải có từ 9 đến 15 chữ số.'); phone.focus(); return; }
  button.disabled = true; button.textContent = 'Đang tra cứu...';
  try {
    const { data = [] } = await PublicLookupService.byPhone(phone.value);
    lookupRows = data;
    results.innerHTML = data.length ? data.map(resultCard).join('') : '<div class="lookup-empty"><strong>Chưa tìm thấy Kiosk</strong><span>Kiểm tra lại số điện thoại hoặc liên hệ hỗ trợ.</span></div>';
  } catch (error) { show(message, error?.message || 'Không thể tra cứu lúc này.'); }
  finally { button.disabled = false; button.textContent = 'Tra cứu'; }
}

function resultCard(item, index) {
  const days = remainingDays(item.endDate);
  return `<article class="lookup-card"><div><span>Kiosk</span><h2>${escapeHtml(item.kiosk || 'Kiosk')}</h2></div><dl><div><dt>Danh mục</dt><dd>${escapeHtml(item.category || '—')}</dd></div><div><dt>Loại hình</dt><dd>${escapeHtml(item.businessType || '—')}</dd></div><div><dt>Ngày bắt đầu</dt><dd>${date(item.startDate)}</dd></div><div><dt>Ngày hết hạn</dt><dd>${date(item.endDate)}</dd></div><div><dt>Thời hạn còn lại</dt><dd>${days >= 0 ? `${days} ngày` : 'Đã hết hạn'}</dd></div><div><dt>Trạng thái</dt><dd><span class="status-pill">${status(item.status, days)}</span></dd></div></dl><button class="btn-primary lookup-renew-button" type="button" data-renew-index="${index}">Gia hạn Kiosk</button><div data-renew-panel="${index}"></div></article>`;
}

function handleResultClick(event) {
  const renew = event.target.closest('[data-renew-index]');
  if (renew) return openRenewal(Number(renew.dataset.renewIndex));
  const create = event.target.closest('[data-create-public-renewal]');
  if (create) return createRenewal(Number(create.dataset.createPublicRenewal));
  if (event.target.closest('[data-lookup-again], [data-renew-retry]')) { window.location.hash = '#/lookup'; window.location.reload(); }
}

function openRenewal(index) {
  const item = lookupRows[index]; const panel = document.querySelector(`[data-renew-panel="${index}"]`);
  if (!item || !panel) return;
  if (!item.renewalAvailable) { panel.innerHTML = blockedRenewalPanel(item.renewalBlockedReason); return; }
  panel.innerHTML = renewalConfirmationCard(item, index, 1);
  panel.querySelectorAll('[name="public-renew-months"]').forEach((input) => input.addEventListener('change', () => updateRenewalConfirmation(item, panel, Number(input.value))));
}

function blockedRenewalPanel(reason) { return `<div class="public-renew-panel public-renew-blocked" role="status"><h3>Chưa thể gia hạn tự động</h3><p>${escapeHtml(renewalBlockedMessage(reason))}</p>${PublicContactLinks({ compact: true })}</div>`; }
export function renewalBlockedMessage(reason) { if (reason === 'PENDING_APPROVAL') return 'Kiosk đang chờ duyệt nên chưa thể gia hạn. Vui lòng liên hệ Admin để được hỗ trợ.'; if (reason === 'INVALID_PRICE') return 'Hiện chưa xác định được giá gia hạn cho Kiosk này. Vui lòng liên hệ Admin để được hỗ trợ.'; return 'Tính năng gia hạn tự động hiện chưa sẵn sàng. Vui lòng liên hệ Admin để được hỗ trợ.'; }

async function createRenewal(index) {
  const item = lookupRows[index]; const panel = document.querySelector(`[data-renew-panel="${index}"]`); const button = panel?.querySelector('[data-create-public-renewal]');
  const months = Number(panel?.querySelector('[name="public-renew-months"]:checked')?.value);
  if (!item || !panel || !ALLOWED_PUBLIC_MONTHS.has(months)) return;
  if (button) { button.disabled = true; button.textContent = 'Đang chuyển đến PayOS...'; }
  try {
    const returnUrl = `${window.location.origin}${window.location.pathname}#/lookup`;
    const { data } = await PublicLookupService.createRenewal({ renewalToken: item.renewalToken, months, returnUrl });
    if (!data?.checkoutUrl) throw new Error('Chưa nhận được link thanh toán PayOS.');
    sessionStorage.setItem(`renewal-payos:${data.orderCode}`, JSON.stringify({ renewalToken: item.renewalToken, orderCode: data.orderCode }));
    window.location.assign(data.checkoutUrl);
  } catch (error) { show(panel.querySelector('[data-renew-error]'), error?.message || 'Không thể tạo thanh toán.'); if (button) { button.disabled = false; button.textContent = 'Thanh toán'; } }
}

async function handleRenewalReturn() {
  const params = payosReturnParams(); const orderCode = params.get('orderCode');
  if (!orderCode) return false;
  const stored = readStoredPayosState(`renewal-payos:${orderCode}`);
  if (!stored.renewalToken || String(stored.orderCode) !== String(orderCode)) {
    clearPayosReturnParams();
    return false;
  }
  document.getElementById('lookup-form')?.classList.add('hidden');
  const target = document.getElementById('lookup-results');
  if (String(params.get('cancel')).toLowerCase() === 'true' || String(params.get('status')).toLowerCase() === 'cancelled') {
    target.innerHTML = '<div class="renew-success"><h3>Bạn đã huỷ thanh toán.</h3><p>Kiosk chưa được gia hạn.</p><button class="btn-primary" type="button" data-renew-retry>Thử lại</button></div>'; return true;
  }
  target.innerHTML = pendingRenewalCard();
  if (!stored.renewalToken) return true;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const { data } = await PublicLookupService.renewalStatus({ renewalToken: stored.renewalToken, orderCode });
      if (data.status === 'paid') { target.innerHTML = renewalSuccessCard(data); return true; }
      if (['cancelled', 'expired', 'failed'].includes(data.status)) { target.innerHTML = terminalRenewalCard(data.status); return true; }
    } catch { /* Keep the public response generic and finish with pending state. */ }
    await new Promise((resolve) => window.setTimeout(resolve, 3000));
  }
  target.innerHTML = pendingRenewalCard(true); return true;
}

export function renewalConfirmationCard(item, index, months) {
  const period = item.renewalPeriods?.[months] || {}; const total = Number(item.pricePerMonth) * months;
  return `<div class="public-renew-panel public-renew-confirmation"><header><span class="public-renew-eyebrow">Gia hạn Kiosk</span><h3>${escapeHtml(item.kiosk || 'Kiosk')}</h3></header><div class="renew-money-row"><span>Giá dịch vụ</span><strong>${formatCurrency(item.pricePerMonth)} / tháng</strong></div><fieldset class="public-renew-duration"><legend>Thời hạn</legend>${[1, 3, 6, 12].map((value) => `<label><input type="radio" name="public-renew-months" value="${value}" ${value === months ? 'checked' : ''}><span>${value} tháng</span></label>`).join('')}</fieldset><dl class="public-renew-preview"><div><dt>Ngày hết hạn hiện tại</dt><dd>${date(item.endDate)}</dd></div><div><dt>Ngày hết hạn dự kiến</dt><dd data-renew-proposed>${date(period.proposedExpiry)}</dd></div><div class="is-total"><dt>Thành tiền</dt><dd data-renew-total>${formatCurrency(total)}</dd></div></dl><p class="form-error hidden" data-renew-error role="alert"></p><button class="btn-primary" type="button" data-create-public-renewal="${index}">Thanh toán</button></div>`;
}

// Compatibility export for callers/tests; inline payment presentation is intentionally gone.
export function renewalPaymentCard(data) { return `<div class="public-renew-panel public-renew-payment-card"><h3>Đang chuyển đến PayOS</h3><p>${escapeHtml(data?.kiosk || 'Kiosk')}</p></div>`; }
function updateRenewalConfirmation(item, panel, months) { const period = item.renewalPeriods?.[months] || {}; panel.querySelector('[data-renew-proposed]').textContent = date(period.proposedExpiry); panel.querySelector('[data-renew-total]').textContent = formatCurrency(Number(item.pricePerMonth) * months); }
function renewalSuccessCard(data) { return `<div class="renew-success public-renew-success"><div class="renew-success-icon">✓</div><h3>Gia hạn thành công</h3><p><strong>${escapeHtml(data.kiosk || 'Kiosk')}</strong></p><dl><div><dt>Đã thanh toán</dt><dd>${formatCurrency(data.amount)}</dd></div><div><dt>Ngày hết hạn cũ</dt><dd>${date(data.currentExpiry)}</dd></div><div><dt>Ngày hết hạn mới</dt><dd>${date(data.newExpiry)}</dd></div><div><dt>Trạng thái thanh toán</dt><dd>Đã hoàn tất</dd></div></dl><button class="btn-primary" type="button" data-lookup-again>Tra cứu lại</button></div>`; }
function pendingRenewalCard(timedOut = false) { return `<div class="renew-success"><h3>Thanh toán đang được xác nhận</h3><p>${timedOut ? 'Thanh toán của bạn đang chờ hệ thống xác nhận. Vui lòng kiểm tra lại sau hoặc liên hệ Admin nếu cần hỗ trợ.' : 'Hệ thống đang chờ webhook PayOS xác nhận giao dịch.'}</p></div>`; }
function terminalRenewalCard(value) { const cancelled = value === 'cancelled'; return `<div class="renew-success"><h3>${cancelled ? 'Bạn đã huỷ thanh toán.' : 'Thanh toán chưa hoàn tất'}</h3><p>Kiosk chưa được gia hạn.</p><button class="btn-primary" type="button" data-renew-retry>Thử lại</button></div>`; }
function payosReturnParams() { const params = new URLSearchParams(window.location.search); const query = String(window.location.hash || '').split('?')[1]; if (query) new URLSearchParams(query).forEach((value, key) => params.set(key, value)); return params; }
function readStoredPayosState(key) { try { return JSON.parse(sessionStorage.getItem(key) || '{}'); } catch { return {}; } }
function clearPayosReturnParams() { window.history.replaceState({}, '', `${window.location.pathname}#/lookup`); }
function show(element, message) { if (element) { element.textContent = message; element.classList.remove('hidden'); } }
function remainingDays(value) { if (!value) return 0; const end = new Date(`${value}T00:00:00`); const today = new Date(); today.setHours(0, 0, 0, 0); return Math.ceil((end - today) / 86400000); }
function date(value) { const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return match ? `${match[3]}/${match[2]}/${match[1]}` : '—'; }
function status(value, days) { if (days < 0) return 'Hết hạn'; return ({ active: 'Đang hoạt động', warning: 'Sắp hết hạn', pending: 'Chờ duyệt' })[value] || 'Đang cập nhật'; }
