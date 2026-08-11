import { Modal } from './Modal.js';
import { Toast } from './Toast.js';
import { KioskService } from '../services/KioskService.js';
import { PaymentService } from '../services/PaymentService.js';
import { formatCurrency } from '../utils/currency.js';
import { formatDate } from '../utils/date.js';
import { calculateRenewalAmounts, calculateRenewalPeriod } from '../utils/renewal.js';
import { escapeHtml } from '../utils/html.js';

let currentKiosk = null;

export async function openRenewKioskForm({ kioskId, onSaved } = {}) {
  currentKiosk = null;
  Modal.open({
    title: 'Gia hạn Kiosk',
    body: renderRenewState('Đang tải Kiosk', 'Đang đọc thông tin Kiosk từ Supabase.'),
    className: 'renew-kiosk-modal',
  });

  try {
    const { data: kiosk } = await KioskService.getById(kioskId);
    currentKiosk = kiosk;
    Modal.open({ title: 'Gia hạn Kiosk', body: renderRenewForm(kiosk), className: 'renew-kiosk-modal' });
    bindRenewForm(onSaved);
  } catch (error) {
    Modal.open({
      title: 'Gia hạn Kiosk',
      body: renderRenewState('Không thể tải Kiosk', error?.message || 'Supabase trả về lỗi khi đọc thông tin Kiosk.'),
      className: 'renew-kiosk-modal',
    });
  }
}

function renderRenewForm(kiosk) {
  const pricePerMonth = Number(kiosk.business_types?.price_per_month || 0);
  const period = calculateRenewalPeriod({ currentEndDate: kiosk.end_date, months: 1, today: vietnamToday() });
  return `
    <form id="renew-kiosk-form" class="modal-form renewal-form" novalidate data-price-per-month="${pricePerMonth}">
      <div id="renew-form-error" class="form-error hidden" role="alert"></div>

      <section class="renew-section" aria-labelledby="renew-current-title">
        <h3 id="renew-current-title">A. Kiosk hiện tại</h3>
        <div class="renew-summary-grid">
          ${summaryItem('Tên Facebook / Kiosk', kiosk.facebook_name)}
          ${summaryItem('Facebook UID', kiosk.facebook_id)}
          ${summaryItem('Khách hàng', kiosk.customers?.facebook_name)}
          ${summaryItem('Số điện thoại', kiosk.customers?.phone)}
          ${summaryItem('Danh mục', kiosk.categories?.name)}
          ${summaryItem('Loại hình kinh doanh', kiosk.business_types?.name)}
          ${summaryItem('Trạng thái', statusLabel(kiosk.status))}
          ${summaryItem('Kỳ hiện tại', `${formatDate(kiosk.start_date)} → ${formatDate(kiosk.end_date)}`)}
          ${summaryItem('Đơn giá hiện tại', formatCurrency(pricePerMonth))}
        </div>
      </section>

      <section class="renew-section" aria-labelledby="renew-period-title">
        <h3 id="renew-period-title">B. Kỳ gia hạn mới</h3>
        <div class="form-row">
          <label class="form-group"><span>Số tháng gia hạn *</span><select class="form-control" id="renew-months" required>${[1,3,6,12].map((month) => `<option value="${month}">${month} tháng</option>`).join('')}</select></label>
          <label class="form-group"><span>Kỳ bắt đầu *</span><input class="form-control" id="renew-start-date" type="date" value="${period.startDate}" required></label>
        </div>
        <label class="form-group"><span>Kỳ kết thúc</span><input class="form-control" id="renew-end-date" type="date" value="${period.endDate}" readonly></label>
        <p class="form-help" id="renew-period-help">Kỳ bắt đầu mặc định được bảo toàn từ ngày hết hạn hiện tại hoặc từ hôm nay nếu Kiosk đã hết hạn.</p>
      </section>

      <section class="renew-section" aria-labelledby="renew-payment-title">
        <h3 id="renew-payment-title">C. Thanh toán</h3>
        <div class="form-row">
          <label class="form-group"><span>Giá gốc *</span><input class="form-control" id="renew-base-amount" type="number" min="0" step="1000" value="${pricePerMonth}" inputmode="numeric" required></label>
          <label class="form-group"><span>Giảm giá</span><input class="form-control" id="renew-discount" type="number" min="0" step="1000" value="0" inputmode="numeric"></label>
        </div>
        <label class="form-group"><span>Lý do giảm giá</span><input class="form-control" id="renew-discount-reason" type="text" autocomplete="off" placeholder="Bắt buộc khi giảm giá lớn hơn 0"></label>
        <div class="form-row">
          <label class="form-group"><span>Số tiền thực thu</span><input class="form-control" id="renew-actual-amount" type="text" value="${formatCurrency(pricePerMonth)}" readonly></label>
          <label class="form-group"><span>Phương thức thanh toán *</span><select class="form-control" id="renew-payment-method" required><option value="transfer">Chuyển khoản</option><option value="cash">Tiền mặt</option><option value="other">Khác</option></select></label>
        </div>
        <label class="form-group"><span>Ghi chú</span><textarea class="form-control" id="renew-note" rows="2"></textarea></label>
      </section>

      <section class="renew-section renew-confirm-section" aria-labelledby="renew-confirm-title">
        <h3 id="renew-confirm-title">D. Xác nhận</h3>
        <div id="renew-confirm-summary" class="renew-confirm-summary">Kiểm tra thông tin rồi chọn “Xem lại & xác nhận”.</div>
      </section>

      <div class="modal-actions">
        <button class="btn-secondary" type="button" data-renew-cancel>Hủy</button>
        <button class="btn-primary" id="renew-save-button" type="submit">Xem lại & xác nhận</button>
      </div>
    </form>`;
}

function bindRenewForm(onSaved) {
  const form = document.getElementById('renew-kiosk-form');
  const months = document.getElementById('renew-months');
  const startDate = document.getElementById('renew-start-date');
  const baseAmount = document.getElementById('renew-base-amount');
  const discount = document.getElementById('renew-discount');
  let awaitingConfirmation = false;

  const update = ({ resetBase = false } = {}) => {
    clearRenewError();
    if (resetBase && baseAmount) baseAmount.value = String(Number(form?.dataset.pricePerMonth || 0) * readNumber('renew-months'));
    try {
      const payload = readRenewPayload();
      const period = calculateRenewalPeriod({ currentEndDate: currentKiosk?.end_date, months: payload.months, today: vietnamToday(), startDate: payload.startDate });
      const amounts = calculateRenewalAmounts(payload);
      document.getElementById('renew-end-date').value = period.endDate;
      document.getElementById('renew-actual-amount').value = formatCurrency(amounts.actualAmount);
      if (awaitingConfirmation) renderConfirmation(payload, period, amounts);
    } catch (error) {
      showRenewError(error.message);
    }
  };

  months?.addEventListener('change', () => update({ resetBase: true }));
  startDate?.addEventListener('change', update);
  baseAmount?.addEventListener('input', update);
  discount?.addEventListener('input', update);

  form?.addEventListener('input', (event) => {
    if (['renew-base-amount', 'renew-discount'].includes(event.target.id)) return;
    if (awaitingConfirmation) {
      awaitingConfirmation = false;
      setSaveLabel('Xem lại & xác nhận');
      document.getElementById('renew-confirm-summary').textContent = 'Thông tin đã thay đổi. Vui lòng xem lại trước khi xác nhận.';
    }
  });

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearRenewError();
    const validation = validateRenewForm();
    if (!validation.valid) return showRenewError(validation.message);
    const payload = readRenewPayload();
    const period = calculateRenewalPeriod({ currentEndDate: currentKiosk.end_date, months: payload.months, today: vietnamToday(), startDate: payload.startDate });
    const amounts = calculateRenewalAmounts(payload);
    if (!awaitingConfirmation) {
      awaitingConfirmation = true;
      renderConfirmation(payload, period, amounts);
      setSaveLabel('Xác nhận đã thanh toán & Gia hạn');
      return;
    }

    const saveButton = document.getElementById('renew-save-button');
    setSaving(saveButton, true);
    try {
      const { data } = await PaymentService.adminManualRenewKiosk(payload);
      await onSaved?.();
      renderRenewSuccess(data, amounts.actualAmount);
      Toast.show('Gia hạn Kiosk thành công');
    } catch (error) {
      showRenewError(error?.message || 'Không thể gia hạn Kiosk.');
      setSaving(saveButton, false);
    }
  });
  update();
}

function validateRenewForm() {
  if (!currentKiosk?.id) return invalid('Kiosk là bắt buộc.');
  const payload = readRenewPayload();
  if (!Number.isInteger(payload.months) || payload.months < 1) return invalid('Số tháng phải là số nguyên lớn hơn 0.');
  if (!payload.startDate) return invalid('Kỳ bắt đầu là bắt buộc.');
  try {
    const period = calculateRenewalPeriod({ currentEndDate: currentKiosk.end_date, months: payload.months, today: vietnamToday(), startDate: payload.startDate });
    if (currentKiosk.end_date >= vietnamToday() && payload.startDate <= currentKiosk.end_date) return invalid('Kỳ mới phải bắt đầu sau ngày hết hạn hiện tại.');
    if (period.endDate <= period.startDate) return invalid('Kỳ kết thúc phải sau kỳ bắt đầu.');
    calculateRenewalAmounts(payload);
  } catch (error) { return invalid(error.message); }
  if (payload.discount > 0 && !payload.discountReason) return invalid('Vui lòng nhập lý do giảm giá.');
  if (!['transfer', 'cash', 'other'].includes(payload.paymentMethod)) return invalid('Vui lòng chọn phương thức thanh toán.');
  return { valid: true };
}

function readRenewPayload() {
  return {
    kioskId: currentKiosk?.id,
    months: readNumber('renew-months'),
    startDate: readValue('renew-start-date'),
    baseAmount: readNumber('renew-base-amount'),
    discount: readNumber('renew-discount'),
    discountReason: readValue('renew-discount-reason'),
    paymentMethod: readValue('renew-payment-method'),
    note: readValue('renew-note'),
  };
}

function renderConfirmation(payload, period, amounts) {
  const target = document.getElementById('renew-confirm-summary');
  if (!target) return;
  target.innerHTML = `<div class="renew-summary-grid">${summaryItem('Kiosk', currentKiosk.facebook_name)}${summaryItem('Kỳ mới', `${formatDate(period.startDate)} → ${formatDate(period.endDate)}`)}${summaryItem('Số tháng', payload.months)}${summaryItem('Giá gốc', formatCurrency(amounts.baseAmount))}${summaryItem('Giảm giá', formatCurrency(amounts.discount))}${summaryItem('Thực thu', formatCurrency(amounts.actualAmount))}</div>`;
}

function renderRenewSuccess(data, fallbackAmount) {
  const payment = data?.payment || {};
  const period = data?.period || {};
  Modal.open({
    title: 'Gia hạn Kiosk thành công',
    className: 'renew-kiosk-modal',
    body: `<div class="renew-success"><h3>Gia hạn Kiosk thành công</h3><div class="renew-summary-grid">${summaryItem('Kỳ mới', `${formatDate(period.start_date)} → ${formatDate(period.end_date)}`)}${summaryItem('Số tiền', formatCurrency(payment.total_amount ?? fallbackAmount))}${summaryItem('Trạng thái', 'Đang hoạt động')}</div><div class="modal-actions"><button class="btn-secondary" type="button" data-renew-cancel>Đóng</button><a class="btn-secondary link-button" href="#/payments">Xem lịch sử thanh toán</a><a class="btn-primary link-button" href="#/kiosk-detail?id=${encodeURIComponent(currentKiosk.id)}">Xem Kiosk</a></div></div>`,
  });
}

function summaryItem(label, value) { return `<div class="renew-summary-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value ?? '—')}</strong></div>`; }
function statusLabel(status) { return ({ active: 'Đang hoạt động', warning: 'Sắp hết hạn', expired: 'Hết hạn', suspended: 'Tạm ngưng', pending: 'Chờ duyệt' })[status] || status || '—'; }
function invalid(message) { return { valid: false, message }; }
function readValue(id) { return document.getElementById(id)?.value.trim() || ''; }
function readNumber(id) { return Number(readValue(id) || 0); }
function vietnamToday() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
function setSaveLabel(label) { const button = document.getElementById('renew-save-button'); if (button) button.textContent = label; }
function showRenewError(message) { const element = document.getElementById('renew-form-error'); if (element) { element.textContent = message; element.classList.remove('hidden'); } }
function clearRenewError() { const element = document.getElementById('renew-form-error'); if (element) { element.textContent = ''; element.classList.add('hidden'); } }
function setSaving(button, saving) { if (button) { button.disabled = saving; button.textContent = saving ? 'Đang gia hạn...' : 'Xác nhận đã thanh toán & Gia hạn'; } }
function renderRenewState(title, message) { return `<div class="empty-state"><div class="empty-state-title">${escapeHtml(title)}</div><div class="empty-state-message">${escapeHtml(message)}</div></div>`; }

if (typeof document !== 'undefined') {
  document.addEventListener('click', (event) => { if (event.target.closest('[data-renew-cancel]')) Modal.close(); });
}
