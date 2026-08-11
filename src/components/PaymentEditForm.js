import { Modal } from './Modal.js';
import { Toast } from './Toast.js';
import { PaymentService } from '../services/PaymentService.js';
import { escapeHtml } from '../utils/html.js';
import { bindCurrencyInput, formatVndNumber, parseCurrencyInput } from '../utils/currency.js';

let currentPayment = null;

export function openPaymentEditForm({ payment, onSaved }) {
  currentPayment = payment;
  if (!currentPayment) return;

  const isCompleted = String(currentPayment.payment_status || '').toLowerCase() === 'completed';

  Modal.open({
    title: isCompleted ? 'Cập nhật ghi chú' : 'Sửa thông tin thanh toán',
    body: renderPaymentEditForm(isCompleted),
  });

  document.getElementById('payment-edit-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const saveButton = document.getElementById('payment-edit-save');
    setSaving(saveButton, true);

    try {
      const payload = readPayload(isCompleted);
      const result = isCompleted
        ? await PaymentService.updateNote(currentPayment.id, payload.note)
        : await PaymentService.updatePending(currentPayment.id, payload);

      Modal.close();
      Toast.show('Đã cập nhật thanh toán.');
      if (onSaved) await onSaved(result.data);

    } catch (error) {
      showError(error?.message || 'Không thể cập nhật thanh toán.');
    } finally {
      setSaving(saveButton, false);
    }
  });

  bindCurrencyInput(document.getElementById('payment-edit-discount'));

  document.querySelector('[data-payment-edit-cancel]')?.addEventListener('click', Modal.close);
}

function renderPaymentEditForm(isCompleted) {
  const p = currentPayment;
  return `
    <form id="payment-edit-form" class="modal-form" novalidate>
      <div id="payment-edit-error" class="form-error hidden"></div>
      <p>Sửa thông tin cho thanh toán ID: <strong>${p.id}</strong></p>

      <fieldset ${isCompleted ? 'disabled' : ''}>
        <div class="form-row">
          <label class="form-group">
            <span>Số tháng *</span>
            <input class="form-control" id="payment-edit-months" type="number" min="1" step="1" value="${p.months || 1}" required />
          </label>
          <label class="form-group">
            <span>Giảm giá</span>
            <input class="form-control" id="payment-edit-discount" type="text" inputmode="numeric" placeholder="0 VNĐ" value="${p.discount ? formatVndNumber(p.discount) : ''}" />
          </label>
        </div>
        <label class="form-group">
          <span>Lý do giảm giá</span>
          <input class="form-control" id="payment-edit-discount-reason" type="text" value="${escapeHtml(p.discount_reason || '')}" />
        </label>
        <label class="form-group">
          <span>Phương thức thanh toán</span>
          <input class="form-control" id="payment-edit-method" type="text" value="${escapeHtml(p.payment_method || '')}" />
        </label>
        <p class="muted-text">Giá, tổng tiền và kỳ hạn dịch vụ được database tính lại. Ngày bắt đầu/kết thúc chỉ được xác lập khi xác nhận.</p>
      </fieldset>

      <label class="form-group">
        <span>Ghi chú</span>
        <textarea class="form-control" id="payment-edit-note" rows="3">${escapeHtml(p.note || '')}</textarea>
      </label>

       <div class="modal-actions">
        <button class="btn-secondary" type="button" data-payment-edit-cancel>Hủy</button>
        <button class="btn-primary" id="payment-edit-save" type="submit">Lưu thay đổi</button>
      </div>
    </form>
  `;
}

function readPayload(isCompleted) {
  if (isCompleted) {
    return {
      note: document.getElementById('payment-edit-note')?.value.trim() || null,
    };
  }

  return {
    months: Number(document.getElementById('payment-edit-months')?.value || 0),
    discount: parseCurrencyInput(document.getElementById('payment-edit-discount')?.value),
    discount_reason: document.getElementById('payment-edit-discount-reason')?.value.trim() || null,
    payment_method: document.getElementById('payment-edit-method')?.value.trim() || null,
    note: document.getElementById('payment-edit-note')?.value.trim() || null,
  };
}

function showError(message) {
  const element = document.getElementById('payment-edit-error');
  if (element) { element.textContent = message; element.classList.remove('hidden'); }
}

function setSaving(button, isSaving) {
  if (!button) return;
  button.disabled = isSaving;
  button.textContent = isSaving ? 'Đang lưu...' : 'Lưu thay đổi';
}
