import { Modal } from './Modal.js';
import { Toast } from './Toast.js';
import { PaymentService } from '../services/PaymentService.js';
import { bindCurrencyInput, formatCurrency, formatVndNumber, parseCurrencyInput } from '../utils/currency.js';
import { formatDate } from '../utils/date.js';
import { escapeHtml } from '../utils/html.js';

export function openHistoricalPaymentEditForm({ payment, kioskName, onSaved } = {}) {
  if (!payment) return;

  Modal.open({
    title: 'Sửa dữ liệu thanh toán',
    className: 'historical-payment-modal',
    body: renderForm(payment, kioskName),
  });

  const amountInput = document.getElementById('historical-payment-amount');
  bindCurrencyInput(amountInput);
  document.querySelector('[data-historical-payment-cancel]')?.addEventListener('click', Modal.close);
  document.getElementById('historical-payment-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = document.getElementById('historical-payment-save');
    const payload = {
      startDate: document.getElementById('historical-payment-start-date')?.value || '',
      endDate: document.getElementById('historical-payment-end-date')?.value || '',
      months: Number(document.getElementById('historical-payment-months')?.value || 0),
      totalAmount: parseCurrencyInput(amountInput?.value),
      reason: document.getElementById('historical-payment-reason')?.value.trim() || '',
    };
    const validationError = validateHistoricalPaymentCorrection(payload);
    if (validationError) {
      showError(validationError);
      return;
    }

    setSaving(button, true);
    try {
      const result = await PaymentService.correctHistorical(payment.id, payload);
      Modal.close();
      Toast.show('Đã sửa dữ liệu thanh toán lịch sử.');
      await onSaved?.(result.data);
    } catch (error) {
      showError(historicalPaymentErrorMessage(error));
    } finally {
      setSaving(button, false);
    }
  });
}

export function historicalPaymentErrorMessage(error) {
  const message = String(error?.message || '').trim();
  if (/correct_historical_payment|pgrst202|schema cache|could not find the function/i.test(message)) {
    return 'Chức năng sửa dữ liệu thanh toán chưa được cài đặt trên database. Vui lòng apply migration trước khi sử dụng.';
  }
  return message || 'Không thể sửa dữ liệu thanh toán.';
}

export function validateHistoricalPaymentCorrection({
  startDate,
  endDate,
  months,
  totalAmount,
  reason,
} = {}) {
  if (!isIsoDate(startDate) || !isIsoDate(endDate)) {
    return 'Ngày bắt đầu và ngày kết thúc là bắt buộc.';
  }
  if (endDate < startDate) return 'Ngày kết thúc không được trước ngày bắt đầu.';
  if (!Number.isInteger(Number(months)) || Number(months) < 1) {
    return 'Số tháng phải là số nguyên lớn hơn 0.';
  }
  if (!Number.isFinite(Number(totalAmount)) || Number(totalAmount) <= 0) {
    return 'Số tiền phải lớn hơn 0.';
  }
  const normalizedReason = String(reason || '').trim();
  if (!normalizedReason) return 'Lý do chỉnh sửa là bắt buộc.';
  if (normalizedReason.length > 1000) return 'Lý do chỉnh sửa không được vượt quá 1000 ký tự.';
  return '';
}

function renderForm(payment, kioskName) {
  return `
    <form id="historical-payment-form" class="modal-form historical-payment-form" novalidate>
      <div id="historical-payment-error" class="form-error hidden" role="alert"></div>
      <div class="historical-payment-warning" role="note">
        <strong>Chỉnh sửa bản ghi đã hoàn thành</strong>
        <span>Thay đổi này ảnh hưởng báo cáo doanh thu và có thể cập nhật thời hạn hiện tại của Kiosk. Hệ thống không tạo giao dịch hoặc gia hạn mới.</span>
      </div>

      <section class="historical-payment-section" aria-labelledby="historical-payment-current-title">
        <h4 id="historical-payment-current-title">Dữ liệu hiện tại</h4>
        <dl class="historical-payment-current">
          <div><dt>Kiosk</dt><dd>${escapeHtml(kioskName || '—')}</dd></div>
          <div><dt>Số tiền</dt><dd>${formatCurrency(payment.total_amount || 0)}</dd></div>
          <div><dt>Thời gian</dt><dd>${formatDate(payment.start_date)} → ${formatDate(payment.end_date)}</dd></div>
          <div><dt>Số tháng</dt><dd>${escapeHtml(payment.months || '—')}</dd></div>
        </dl>
      </section>

      <section class="historical-payment-section" aria-labelledby="historical-payment-new-title">
        <h4 id="historical-payment-new-title">Dữ liệu sau chỉnh sửa</h4>
        <div class="form-row">
          <label class="form-group">
            <span>Ngày bắt đầu *</span>
            <input class="form-control" id="historical-payment-start-date" type="date" value="${escapeHtml(payment.start_date || '')}" required>
          </label>
          <label class="form-group">
            <span>Ngày kết thúc *</span>
            <input class="form-control" id="historical-payment-end-date" type="date" value="${escapeHtml(payment.end_date || '')}" required>
          </label>
        </div>
        <label class="form-group">
          <span>Số tháng *</span>
          <input class="form-control" id="historical-payment-months" type="number" min="1" step="1" value="${escapeHtml(payment.months || 1)}" required>
          <small>Đây là metadata lịch sử; hệ thống không tự suy đoán số tháng từ khoảng ngày.</small>
        </label>
        <label class="form-group">
          <span>Tổng tiền *</span>
          <input class="form-control" id="historical-payment-amount" type="text" inputmode="numeric" value="${formatVndNumber(payment.total_amount || 0)}" required>
        </label>
        <label class="form-group">
          <span>Lý do chỉnh sửa *</span>
          <textarea class="form-control" id="historical-payment-reason" rows="4" maxlength="1000" placeholder="Dữ liệu import cũ bị nhập sai. Đã đối chiếu với dữ liệu thực tế." required></textarea>
        </label>
      </section>

      <div class="modal-actions">
        <button class="btn-secondary" type="button" data-historical-payment-cancel>Hủy</button>
        <button class="btn-primary" id="historical-payment-save" type="submit">Lưu thay đổi</button>
      </div>
    </form>
  `;
}

function isIsoDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCFullYear() === Number(match[1])
    && date.getUTCMonth() === Number(match[2]) - 1
    && date.getUTCDate() === Number(match[3]);
}

function showError(message) {
  const element = document.getElementById('historical-payment-error');
  if (!element) return;
  element.textContent = message;
  element.classList.remove('hidden');
  element.focus?.();
}

function setSaving(button, saving) {
  if (!button) return;
  button.disabled = saving;
  button.textContent = saving ? 'Đang lưu...' : 'Lưu thay đổi';
}
