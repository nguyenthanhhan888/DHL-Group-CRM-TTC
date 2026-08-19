import { Modal } from './Modal.js';
import { bindPayosCopyButtons, PayosResultCard, watchPayosPaymentStatus } from './PayosResultCard.js';
import { Toast } from './Toast.js';
import { KioskService } from '../services/KioskService.js';
import { PayosService } from '../services/PayosService.js';
import { PaymentService } from '../services/PaymentService.js';
import { bindCurrencyInput, formatCurrency, parseCurrencyInput } from '../utils/currency.js';
import { formatDate, parseDateOnly, startOfToday, toDateOnly } from '../utils/date.js';
import { escapeHtml } from '../utils/html.js';
import { renderIcon } from '../utils/icons.js';

let currentKiosk = null;

export async function openRenewKioskForm({ kioskId, onSaved } = {}) {
  currentKiosk = null;
  Modal.open({ title: 'Gia hạn Kiosk', body: stateView('Đang tải Kiosk', 'Đang đọc thông tin Kiosk từ hệ thống.') });
  try {
    ({ data: currentKiosk } = await KioskService.getById(kioskId));
    Modal.open({ title: 'Gia hạn Kiosk', body: formView(currentKiosk) });
    bindForm(onSaved);
    updateCalculation();
  } catch (error) {
    Modal.open({ title: 'Gia hạn Kiosk', body: stateView('Không thể tải Kiosk', error?.message || 'Không đọc được thông tin Kiosk.') });
  }
}

function formView(kiosk) {
  const price = Number(kiosk.business_types?.price_per_month || 0);
  const startDate = renewalStartDate(kiosk.end_date);
  return `<form id="renew-kiosk-form" class="modal-form renew-admin-form" novalidate data-price="${price}" data-start-date="${startDate}">
    <div id="renew-form-error" class="form-error hidden" role="alert"></div>
    <div class="renew-summary">
      ${detail('Kiosk', kiosk.facebook_name)}${detail('Facebook ID', kiosk.facebook_id)}${detail('Danh mục', kiosk.categories?.name)}${detail('Loại hình kinh doanh', kiosk.business_types?.name)}${detail('Ngày hết hạn hiện tại', formatDate(kiosk.end_date))}
    </div>
    <section class="renew-calculation" aria-label="Tính tiền gia hạn">
      <label class="form-group"><span>Số tháng gia hạn *</span><input class="form-control" id="renew-months" type="number" min="1" max="120" step="1" value="1" required></label>
      <div class="renew-money-row"><span>Giá dịch vụ</span><strong id="renew-unit-price">${formatCurrency(price)} / tháng</strong></div>
      <div class="renew-money-row"><span>Tạm tính</span><strong id="renew-subtotal">${formatCurrency(price)}</strong></div>
      <label class="form-group renew-discount-field"><span>Giảm giá</span><input class="form-control" id="renew-discount" type="text" inputmode="numeric" placeholder="0"></label>
      <label class="form-group"><span>Lý do giảm giá</span><input class="form-control" id="renew-discount-reason" autocomplete="off"></label>
      <div class="renew-total"><span>THÀNH TIỀN</span><strong id="renew-total">${formatCurrency(price)}</strong></div>
    </section>
    <fieldset class="renew-payment-paths"><legend>Trạng thái thanh toán</legend>
      <label><input type="radio" name="renew-payment-path" value="paid" checked><span><strong>Đã nhận thanh toán</strong><small>Admin đã nhận tiền trực tiếp; không tạo QR.</small></span></label>
      <label><input type="radio" name="renew-payment-path" value="payos"><span><strong>Khách hàng chưa thanh toán</strong><small>Tạo thanh toán Pending và link PayOS.</small></span></label>
    </fieldset>
    <label class="form-group" data-manual-method><span>Phương thức thanh toán *</span><select class="form-control" id="renew-payment-method"><option value="transfer">Chuyển khoản</option><option value="cash">Tiền mặt</option><option value="other">Khác</option></select></label>
    <label class="form-group"><span>Ghi chú</span><textarea class="form-control" id="renew-note" rows="2"></textarea></label>
    <p class="renew-period-preview">Kỳ dự kiến: <strong id="renew-period">${formatDate(startDate)} → ${formatDate(calendarPeriodEnd(startDate, 1))}</strong></p>
    <div class="modal-actions"><button class="btn-secondary" type="button" data-renew-cancel>Hủy</button><button class="btn-primary" id="renew-save-button" type="submit">Xác nhận đã thanh toán &amp; Gia hạn</button></div>
  </form>`;
}

function bindForm(onSaved) {
  const form = document.getElementById('renew-kiosk-form');
  bindCurrencyInput(document.getElementById('renew-discount'));
  ['renew-months', 'renew-discount'].forEach((id) => document.getElementById(id)?.addEventListener('input', updateCalculation));
  document.querySelectorAll('input[name="renew-payment-path"]').forEach((radio) => radio.addEventListener('change', updatePath));
  form?.addEventListener('submit', async (event) => {
    event.preventDefault(); clearError();
    const values = readValues();
    const error = validate(values);
    if (error) return showError(error);
    const button = document.getElementById('renew-save-button');
    setSaving(button, true, values.path);
    try {
      if (values.path === 'paid') await submitManual(values, onSaved);
      else await submitPayos(values, onSaved);
    } catch (submitError) { showError(submitError?.message || 'Không thể gia hạn Kiosk.'); }
    finally { setSaving(button, false, values.path); }
  });
}

async function submitManual(values, onSaved) {
  const { data } = await PaymentService.manualRenewKiosk({ kioskId: currentKiosk.id, months: values.months, startDate: values.startDate, baseAmount: values.subtotal, discount: values.discount, discountReason: values.discountReason, paymentMethod: values.paymentMethod, note: values.note });
  const period = data?.period || {};
  Modal.open({ title: 'Gia hạn thành công', body: `<div class="renew-success"><div class="renew-success-icon">${renderIcon('check-circle')}</div><h3>Gia hạn thành công</h3>${detail('Kỳ mới', `${formatDate(period.start_date)} → ${formatDate(period.end_date)}`)}${detail('Số tiền', formatCurrency(data?.payment?.total_amount ?? values.total))}${detail('Phương thức', methodLabel(data?.payment?.payment_method || values.paymentMethod))}${detail('Trạng thái', 'Đang hoạt động')}</div><div class="modal-actions"><button class="btn-primary" type="button" data-renew-cancel>Đóng</button></div>` });
  Toast.show('Gia hạn Kiosk thành công.'); await onSaved?.();
}

async function submitPayos(values, onSaved) {
  const { data } = await PaymentService.renewKiosk({ kioskId: currentKiosk.id, months: values.months, discount: values.discount, discountReason: values.discountReason, note: values.note });
  const payment = data?.payment || data;
  const paymentId = payment?.id || data?.payment_id;
  const amount = Number(payment?.total_amount || values.total);
  if (!paymentId) throw new Error('Đã tạo thanh toán Pending nhưng chưa đọc được mã thanh toán.');
  Modal.open({ title: 'PayOS gia hạn Kiosk', body: `<div class="approval-message"><p>Thanh toán đang Pending. Kiosk chỉ được gia hạn sau khi webhook PayOS xác nhận thành công.</p><div id="renew-payos-result"><p class="muted-text">Đang tạo link PayOS...</p></div></div><div class="modal-actions"><button class="btn-secondary" type="button" data-renew-cancel>Đóng</button></div>` });
  const { data: payos } = await PayosService.createCrmPayment({ paymentId, amount, description: `DHL${paymentId}`, returnUrl: routeUrl(), cancelUrl: routeUrl() });
  const container = document.getElementById('renew-payos-result');
  if (container) { container.innerHTML = PayosResultCard({ ...payos, note: 'Gửi link cho khách hàng hoặc mở PayOS. Webhook sẽ hoàn tất gia hạn.' }); bindPayosCopyButtons(container); watchPayosPaymentStatus(container, { onPaid: () => { Toast.show('PayOS đã xác nhận thanh toán gia hạn.'); onSaved?.(); } }); }
  if (payos.checkoutUrl) window.open(payos.checkoutUrl, '_blank', 'noopener,noreferrer');
  Toast.show('Đã tạo thanh toán Pending và link PayOS.'); await onSaved?.();
}

function updateCalculation() {
  const values = readValues();
  setText('renew-unit-price', `${formatCurrency(values.price)} / tháng`); setText('renew-subtotal', formatCurrency(values.subtotal)); setText('renew-total', formatCurrency(values.total)); setText('renew-period', `${formatDate(values.startDate)} → ${formatDate(calendarPeriodEnd(values.startDate, values.months || 1))}`);
}
function updatePath() { const path = document.querySelector('input[name="renew-payment-path"]:checked')?.value || 'paid'; document.querySelector('[data-manual-method]')?.classList.toggle('hidden', path !== 'paid'); setSaving(document.getElementById('renew-save-button'), false, path); }
function readValues() { const form = document.getElementById('renew-kiosk-form'); const price = Number(form?.dataset.price || 0); const months = number('renew-months'); const discount = parseCurrencyInput(value('renew-discount')); const subtotal = price * months; return { price, months, discount, subtotal, total: Math.max(0, subtotal - discount), discountReason: value('renew-discount-reason'), paymentMethod: value('renew-payment-method'), note: value('renew-note'), path: document.querySelector('input[name="renew-payment-path"]:checked')?.value || 'paid', startDate: form?.dataset.startDate || '' }; }
function validate(v) { if (!currentKiosk?.id) return 'Kiosk là bắt buộc.'; if (!Number.isInteger(v.months) || v.months < 1 || v.months > 120) return 'Số tháng phải từ 1 đến 120.'; if (!Number.isFinite(v.price) || v.price < 0) return 'Giá dịch vụ hiện tại không hợp lệ.'; if (!Number.isFinite(v.discount) || v.discount < 0 || v.discount > v.subtotal) return 'Giảm giá phải từ 0 đến tạm tính.'; if (v.discount > 0 && !v.discountReason) return 'Vui lòng nhập lý do giảm giá.'; return ''; }

export function renewalStartDate(endDate, today = startOfToday()) { const end = endDate ? parseDateOnly(endDate) : null; const baseToday = new Date(today); baseToday.setHours(0,0,0,0); if (end && !Number.isNaN(end.getTime()) && end >= baseToday) { end.setDate(end.getDate() + 1); return toDateOnly(end); } return toDateOnly(baseToday); }
export function calendarPeriodEnd(startDate, months) { const start = parseDateOnly(startDate); const targetMonth = start.getMonth() + Number(months || 0); const lastDay = new Date(start.getFullYear(), targetMonth + 1, 0).getDate(); const end = new Date(start.getFullYear(), targetMonth, Math.min(start.getDate(), lastDay)); end.setDate(end.getDate() - 1); return toDateOnly(end); }
function detail(label, raw) { return `<div class="setting-item"><span class="setting-name">${escapeHtml(label)}</span><span class="setting-value detail-value">${escapeHtml(raw || '—')}</span></div>`; }
function stateView(title, message) { return `<div class="empty-state"><div class="empty-state-icon">∅</div><div class="empty-state-title">${escapeHtml(title)}</div><div class="empty-state-message">${escapeHtml(message)}</div></div>`; }
function methodLabel(value) { return ({ transfer: 'Chuyển khoản', cash: 'Tiền mặt', other: 'Khác' })[value] || value || '—'; }
function value(id) { return document.getElementById(id)?.value.trim() || ''; } function number(id) { return Number(value(id) || 0); } function setText(id, text) { const element = document.getElementById(id); if (element) element.textContent = text; }
function showError(message) { const element = document.getElementById('renew-form-error'); if (element) { element.textContent = message; element.classList.remove('hidden'); } } function clearError() { document.getElementById('renew-form-error')?.classList.add('hidden'); }
function setSaving(button, saving, path) { if (!button) return; button.disabled = saving; button.textContent = saving ? (path === 'paid' ? 'Đang xác nhận...' : 'Đang tạo link...') : (path === 'paid' ? 'Xác nhận đã thanh toán & Gia hạn' : 'Tạo PayOS'); }
function routeUrl() { return `${window.location.origin}${window.location.pathname}#/kiosk-detail?id=${currentKiosk?.id || ''}`; }
if (typeof document !== 'undefined') document.addEventListener('click', (event) => { if (event.target.matches('[data-renew-cancel]')) Modal.close(); });
