import { Modal } from './Modal.js';
import { bindPayosCopyButtons, PayosResultCard } from './PayosResultCard.js';
import { Toast } from './Toast.js';
import { KioskService } from '../services/KioskService.js';
import { PayosService } from '../services/PayosService.js';
import { PaymentService } from '../services/PaymentService.js';
import { formatCurrency } from '../utils/currency.js';
import { formatDate } from '../utils/date.js';
import { escapeHtml } from '../utils/html.js';

let currentKiosk = null;

export async function openRenewKioskForm({ kioskId, onSaved } = {}) {
  currentKiosk = null;
  Modal.open({
    title: 'Gia hạn Kiosk',
    body: renderRenewState('Đang tải Kiosk', 'Đang đọc thông tin kiosk từ Supabase.'),
  });

  try {
    const { data: kiosk } = await KioskService.getById(kioskId);
    currentKiosk = kiosk;

    Modal.open({
      title: 'Gia hạn Kiosk',
      body: renderRenewForm(kiosk),
    });
    bindRenewForm(onSaved);
  } catch (error) {
    Modal.open({
      title: 'Gia hạn Kiosk',
      body: renderRenewState(
        'Không thể tải Kiosk',
        error?.message || 'Supabase trả về lỗi khi đọc thông tin kiosk.',
      ),
    });
  }
}

function bindRenewForm(onSaved) {
  const form = document.getElementById('renew-kiosk-form');

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearRenewError();

    const validation = validateRenewForm();
    if (!validation.valid) {
      showRenewError(validation.message);
      return;
    }

    const saveButton = document.getElementById('renew-save-button');
    setSaving(saveButton, true);

    try {
      const payload = readRenewPayload();
      const { data } = await PaymentService.renewKiosk(payload);
      Toast.show('Đã tạo thanh toán gia hạn ở trạng thái chờ xác nhận.');
      await renderRenewPayosResult(data);
      await onSaved?.();
    } catch (error) {
      showRenewError(error?.message || 'Không thể gia hạn kiosk.');
    } finally {
      setSaving(saveButton, false);
    }
  });
}

async function renderRenewPayosResult(renewalData = {}) {
  const payment = renewalData?.payment || renewalData;
  const paymentId = payment?.id || renewalData?.payment_id;
  const amount = Number(payment?.total_amount || renewalData?.total_amount || 0);

  if (!paymentId || !amount) {
    Modal.open({
      title: 'Gia hạn Kiosk',
      body: `
        ${renderRenewState('Đã tạo payment pending', 'Chưa đọc được đủ payment ID/số tiền để tạo PayOS tự động. Có thể tạo lại PayOS trong trang Thanh toán.')}
        <div class="modal-actions"><button class="btn-secondary" type="button" data-renew-cancel>Đóng</button></div>
      `,
    });
    return;
  }

  Modal.open({
    title: 'Thanh toán gia hạn Kiosk',
    body: `
      <div class="approval-message">
        <p>Payment gia hạn đã được tạo ở trạng thái Pending. Quét QR hoặc mở checkout PayOS để thanh toán.</p>
        <div id="renew-payos-result"><p class="muted-text">Đang tạo link PayOS...</p></div>
      </div>
      <div class="modal-actions"><button class="btn-secondary" type="button" data-renew-cancel>Đóng</button></div>
    `,
  });

  try {
    const { data } = await PayosService.createCrmPayment({
      paymentId,
      amount,
      description: `DHL${paymentId}`,
      returnUrl: buildPayosRouteUrl(`#/kiosk-detail?id=${currentKiosk?.id || ''}`),
      cancelUrl: buildPayosRouteUrl(`#/kiosk-detail?id=${currentKiosk?.id || ''}`),
    });
    const container = document.getElementById('renew-payos-result');
    if (container) {
      container.innerHTML = PayosResultCard({
        amountLabel: formatCurrency(amount),
        checkoutUrl: data.checkoutUrl,
        orderCode: data.orderCode,
        paymentLinkId: data.paymentLinkId,
        qrCode: data.qrCode,
        note: 'Webhook PayOS sẽ tự xác nhận gia hạn khi ngân hàng báo thanh toán thành công.',
      });
      bindPayosCopyButtons(container);
    }
  } catch (error) {
    const container = document.getElementById('renew-payos-result');
    if (container) {
      container.innerHTML = `<div class="form-error">${escapeHtml(error?.message || 'Không tạo được PayOS. Có thể tạo lại trong trang Thanh toán.')}</div>`;
    }
  }
}

function renderRenewForm(kiosk) {
  return `
    <form id="renew-kiosk-form" class="modal-form" novalidate>
      <div id="renew-form-error" class="form-error hidden"></div>

      <div class="renew-summary">
        <div class="setting-item">
          <span class="setting-name">Kiosk</span>
          <span class="setting-value detail-value">${escapeHtml(kiosk.facebook_name || '—')}</span>
        </div>
        <div class="setting-item">
          <span class="setting-name">Facebook ID</span>
          <span class="setting-value detail-value">${escapeHtml(kiosk.facebook_id || '—')}</span>
        </div>
        <div class="setting-item">
          <span class="setting-name">Loại hình kinh doanh</span>
          <span class="setting-value detail-value">${escapeHtml(kiosk.business_types?.name || '—')}</span>
        </div>
        <div class="setting-item">
          <span class="setting-name">Ngày hết hạn hiện tại</span>
          <span class="setting-value detail-value">${formatDate(kiosk.end_date)}</span>
        </div>
      </div>

      <div class="form-row">
        <label class="form-group">
          <span>Số tháng *</span>
          <input class="form-control" id="renew-months" type="number" min="1" step="1" value="1" required />
        </label>
        <label class="form-group">
          <span>Giảm giá</span>
          <input class="form-control" id="renew-discount" type="number" min="0" step="1000" value="0" />
        </label>
      </div>

      <label class="form-group">
        <span>Lý do giảm giá</span>
        <input class="form-control" id="renew-discount-reason" type="text" autocomplete="off" />
      </label>

      <label class="form-group">
        <span>Ghi chú</span>
        <textarea class="form-control" id="renew-note" rows="2"></textarea>
      </label>

      <p class="muted-text">
        Database sẽ đọc gói dịch vụ, tính giá và tạo thanh toán Pending.
        Kỳ hạn chính thức chỉ được tính tại thời điểm xác nhận thanh toán.
      </p>

      <div class="modal-actions">
        <button class="btn-secondary" type="button" data-renew-cancel>Hủy</button>
        <button class="btn-primary" id="renew-save-button" type="submit">Gia hạn</button>
      </div>
    </form>
  `;
}

function renderRenewState(title, message) {
  return `
    <div class="empty-state">
      <div class="empty-state-icon">∅</div>
      <div class="empty-state-title">${escapeHtml(title)}</div>
      <div class="empty-state-message">${escapeHtml(message)}</div>
    </div>
  `;
}

function readRenewPayload() {
  return {
    kioskId: currentKiosk?.id,
    months: readNumber('renew-months'),
    discount: readNumber('renew-discount'),
    discountReason: readValue('renew-discount-reason'),
    note: readValue('renew-note'),
  };
}

function validateRenewForm() {
  if (!currentKiosk?.id) {
    return { valid: false, message: 'Kiosk là bắt buộc.' };
  }

  const months = readNumber('renew-months');
  if (!Number.isInteger(months) || months < 1) {
    return { valid: false, message: 'Số tháng phải là số nguyên lớn hơn 0.' };
  }

  const discount = readNumber('renew-discount');
  if (!Number.isFinite(discount) || discount < 0) {
    return { valid: false, message: 'Giảm giá không hợp lệ.' };
  }

  return { valid: true };
}

function readValue(id) {
  return document.getElementById(id)?.value.trim() || '';
}

function readNumber(id) {
  return Number(readValue(id) || 0);
}

function showRenewError(message) {
  const element = document.getElementById('renew-form-error');
  if (!element) return;
  element.textContent = message;
  element.classList.remove('hidden');
}

function clearRenewError() {
  const element = document.getElementById('renew-form-error');
  if (!element) return;
  element.textContent = '';
  element.classList.add('hidden');
}

function setSaving(button, isSaving) {
  if (!button) return;
  button.disabled = isSaving;
  button.textContent = isSaving ? 'Đang gia hạn...' : 'Gia hạn';
}

function buildPayosRouteUrl(route) {
  return `${window.location.origin}${window.location.pathname}${route}`;
}

if (typeof document !== 'undefined') {
  document.addEventListener('click', (event) => {
    if (event.target.matches('[data-renew-cancel]')) {
      Modal.close();
    }
  });
}
