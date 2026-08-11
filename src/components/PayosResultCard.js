import { escapeHtml } from '../utils/html.js';

export function PayosResultCard({
  amountLabel = '',
  accountName = '',
  accountNumber = '',
  bankName = '',
  bin = '',
  checkoutUrl = '',
  description = '',
  orderCode = '',
  paymentLinkId = '',
  qrCode = '',
  note = 'Xu/gói sẽ tự kích hoạt sau khi ngân hàng xác nhận thanh toán.',
  className = '',
} = {}) {
  const classes = ['payos-result', className].filter(Boolean).join(' ');
  const transferInfo = getPayosTransferInfo({
    accountName,
    accountNumber,
    amountLabel,
    bankName,
    bin,
    description,
    qrCode,
  });
  return `
    <div class="${escapeHtml(classes)}" data-payos-order-code="${escapeHtml(orderCode || '')}" data-payos-payment-link-id="${escapeHtml(paymentLinkId || '')}">
      <div class="payos-result-header">
        <div>
          <div class="payos-result-title">Thanh toán</div>
          ${amountLabel ? `<div class="payos-result-amount">${escapeHtml(amountLabel)}</div>` : ''}
        </div>
        <span class="status-pill" data-payos-status-pill>Chờ ngân hàng</span>
      </div>
      ${note ? `<p class="payos-result-note" data-payos-status-note>${escapeHtml(note)}</p>` : ''}
      <div class="payos-result-body">
        ${renderPayosQr(qrCode)}
        <div class="payos-result-details">
          ${renderCopyRow('Ngân hàng', transferInfo.bankName)}
          ${renderCopyRow('Chủ tài khoản', transferInfo.accountName)}
          ${renderCopyRow('Số tài khoản', transferInfo.accountNumber)}
          ${renderCopyRow('Số tiền', transferInfo.amountLabel)}
          ${renderCopyRow('Nội dung', transferInfo.description)}
          <div class="payos-actions">
            ${checkoutUrl ? `<a class="btn-primary link-button" href="${escapeHtml(checkoutUrl)}" target="_blank" rel="noopener noreferrer">Mở trang thanh toán</a>` : ''}
            ${checkoutUrl ? `<button class="btn-secondary" type="button" data-copy-text="${escapeHtml(checkoutUrl)}">Sao chép link</button>` : ''}
          </div>
        </div>
      </div>
    </div>
  `;
}

const PAYOS_BANK_NAMES = {
  970422: 'MB',
};

const PAYOS_ROW_ICONS = {
  'Ngân hàng': 'MB',
  'Chủ tài khoản': 'CT',
  'Số tài khoản': 'STK',
  'Số tiền': 'VNĐ',
  'Nội dung': 'ND',
};

function getPayosTransferInfo({
  accountName = '',
  accountNumber = '',
  amountLabel = '',
  bankName = '',
  bin = '',
  description = '',
  qrCode = '',
} = {}) {
  const qrInfo = parseVietQrPayload(qrCode);
  const normalizedBin = String(bin || qrInfo.bin || '').trim();
  return {
    accountName: accountName || qrInfo.accountName || '',
    accountNumber: accountNumber || qrInfo.accountNumber || '',
    amountLabel,
    bankName: bankName || PAYOS_BANK_NAMES[normalizedBin] || normalizedBin,
    description: description || qrInfo.description || '',
  };
}

function parseVietQrPayload(qrCode) {
  const text = String(qrCode || '').trim();
  if (!text || /^(https?:|data:image\/)/i.test(text)) return {};

  const root = parseEmvTlv(text);
  const merchantAccount = root.get('38') || root.get('26') || '';
  const merchantFields = parseEmvTlv(merchantAccount);
  const bankPayload = merchantFields.get('01') || merchantFields.get('02') || '';
  const bankFields = parseEmvTlv(bankPayload);
  const additionalFields = parseEmvTlv(root.get('62') || '');
  const bin = bankFields.get('00') || merchantFields.get('00') || '';

  return {
    accountName: root.get('59') || '',
    accountNumber: bankFields.get('01') || bankFields.get('02') || '',
    bin,
    description: additionalFields.get('08') || additionalFields.get('05') || '',
  };
}

function parseEmvTlv(payload) {
  const fields = new Map();
  let index = 0;
  while (index + 4 <= payload.length) {
    const tag = payload.slice(index, index + 2);
    const length = Number(payload.slice(index + 2, index + 4));
    if (!/^\d{2}$/.test(tag) || !Number.isInteger(length) || length < 0) break;
    const start = index + 4;
    const end = start + length;
    if (end > payload.length) break;
    fields.set(tag, payload.slice(start, end));
    index = end;
  }
  return fields;
}

export function bindPayosCopyButtons(root = document) {
  root.querySelectorAll('[data-copy-text]').forEach((button) => {
    button.addEventListener('click', async () => {
      const text = button.dataset.copyText || '';
      if (!text) return;
      try {
        await navigator.clipboard?.writeText(text);
        const originalText = button.dataset.copyLabel || button.textContent || 'Sao chép';
        button.textContent = 'Đã sao chép';
        window.setTimeout(() => {
          button.textContent = originalText;
        }, 1600);
      } catch {
        window.prompt('Sao chép thông tin thanh toán:', text);
      }
    });
  });
}

export function watchPayosPaymentStatus(root = document, {
  intervalMs = 3000,
  timeoutMs = 180000,
  onPaid,
} = {}) {
  const cards = root.querySelectorAll('[data-payos-order-code]:not([data-payos-watch-bound="true"])');
  cards.forEach((card) => {
    const orderCode = String(card.dataset.payosOrderCode || '').trim();
    const paymentLinkId = String(card.dataset.payosPaymentLinkId || '').trim();
    if (!orderCode || !paymentLinkId) return;

    card.dataset.payosWatchBound = 'true';
    const startedAt = Date.now();
    let timerId = 0;

    const stop = () => {
      if (timerId) window.clearTimeout(timerId);
      timerId = 0;
    };

    const tick = async () => {
      try {
        const status = await fetchPayosStatus(orderCode, paymentLinkId);
        if (String(status?.status || '').toLowerCase() === 'paid') {
          stop();
          markPayosCardPaid(card);
          if (typeof onPaid === 'function') onPaid(status, card);
          return;
        }
      } catch {
        // Keep polling quietly; the user still has the external payOS link as fallback.
      }

      if (Date.now() - startedAt < timeoutMs) {
        timerId = window.setTimeout(tick, intervalMs);
      }
    };

    tick();
  });
}

async function fetchPayosStatus(orderCode, paymentLinkId) {
  const query = new URLSearchParams({
    orderCode,
    paymentLinkId,
  });
  const response = await fetch(`/api/payos/status?${query.toString()}`, {
    headers: { Accept: 'application/json' },
  });
  const data = await safeJson(response);
  if (!response.ok || data?.success === false) {
    throw new Error(data?.message || 'Không kiểm tra được trạng thái PayOS.');
  }
  return data;
}

function markPayosCardPaid(card) {
  card.classList.add('payos-result-paid');
  const pill = card.querySelector('[data-payos-status-pill]');
  if (pill) {
    pill.classList.add('success');
    pill.textContent = 'Đã thanh toán';
  }
  const note = card.querySelector('[data-payos-status-note]');
  if (note) {
    note.textContent = 'Đã nhận được thanh toán. Hệ thống đang cập nhật dữ liệu liên quan.';
  }
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function renderCopyRow(label, value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const icon = PAYOS_ROW_ICONS[label] || 'TT';
  return `
    <div class="payos-link-row">
      <span><span class="payos-row-icon">${escapeHtml(icon)}</span>${escapeHtml(label)}</span>
      <div class="payos-copy-value">
        <code>${escapeHtml(text)}</code>
        <button class="btn-secondary compact-button" type="button" data-copy-label="Sao chép" data-copy-text="${escapeHtml(text)}">Sao chép</button>
      </div>
    </div>
  `;
}

function renderPayosQr(qrCode) {
  if (!qrCode) {
    return `
      <div class="payos-qr-placeholder">
        <span>QR</span>
        <small>Mở trang thanh toán để hoàn tất</small>
      </div>
    `;
  }

  const normalized = String(qrCode).trim();
  if (!normalized) {
    return `
      <div class="payos-qr-placeholder">
        <span>QR</span>
        <small>Mở trang thanh toán để hoàn tất</small>
      </div>
    `;
  }

  const src = /^(https?:|data:image\/)/i.test(normalized)
    ? normalized
    : `https://api.qrserver.com/v1/create-qr-code/?size=360x360&ecc=M&qzone=2&data=${encodeURIComponent(normalized)}`;

  return `
    <a class="payos-qr-frame" href="${escapeHtml(src)}" target="_blank" rel="noopener noreferrer" aria-label="Mở ảnh QR thanh toán">
      <img class="payos-qr-code" src="${escapeHtml(src)}" alt="QR thanh toán" loading="lazy" />
    </a>
  `;
}
