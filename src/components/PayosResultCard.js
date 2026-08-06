import { escapeHtml } from '../utils/html.js';

export function PayosResultCard({
  amountLabel = '',
  checkoutUrl = '',
  orderCode = '',
  paymentLinkId = '',
  qrCode = '',
  note = 'Xu/gói chỉ được kích hoạt sau khi PayOS webhook xác nhận thanh toán.',
  className = '',
} = {}) {
  const classes = ['payos-result', className].filter(Boolean).join(' ');
  return `
    <div class="${escapeHtml(classes)}">
      <div class="payos-result-header">
        <div>
          <div class="payos-result-title">Thanh toán PayOS</div>
          ${amountLabel ? `<div class="payos-result-amount">${escapeHtml(amountLabel)}</div>` : ''}
        </div>
        <span class="status-pill">Chờ ngân hàng</span>
      </div>
      ${note ? `<p class="payos-result-note">${escapeHtml(note)}</p>` : ''}
      <div class="payos-result-body">
        ${renderPayosQr(qrCode)}
        <div class="payos-result-details">
          <div class="payos-link-row">
            <span>Order code</span>
            <code>${escapeHtml(String(orderCode || '—'))}</code>
          </div>
          <div class="payos-link-row">
            <span>Payment link ID</span>
            <code>${escapeHtml(paymentLinkId || '—')}</code>
          </div>
          <div class="payos-actions">
            ${checkoutUrl ? `<a class="btn-primary link-button" href="${escapeHtml(checkoutUrl)}" target="_blank" rel="noopener noreferrer">Mở checkout PayOS</a>` : ''}
            ${checkoutUrl ? `<button class="btn-secondary" type="button" data-copy-text="${escapeHtml(checkoutUrl)}">Sao chép link</button>` : ''}
          </div>
        </div>
      </div>
    </div>
  `;
}

export function bindPayosCopyButtons(root = document) {
  root.querySelectorAll('[data-copy-text]').forEach((button) => {
    button.addEventListener('click', async () => {
      const text = button.dataset.copyText || '';
      if (!text) return;
      try {
        await navigator.clipboard?.writeText(text);
        button.textContent = 'Đã sao chép';
        window.setTimeout(() => {
          button.textContent = 'Sao chép link';
        }, 1600);
      } catch {
        window.prompt('Sao chép link PayOS:', text);
      }
    });
  });
}

function renderPayosQr(qrCode) {
  if (!qrCode) {
    return `
      <div class="payos-qr-placeholder">
        <span>QR</span>
        <small>Mở checkout PayOS để thanh toán</small>
      </div>
    `;
  }

  const normalized = String(qrCode);
  const src = /^(https?:|data:image\/)/i.test(normalized)
    ? normalized
    : `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(normalized)}`;

  return `
    <a class="payos-qr-frame" href="${escapeHtml(src)}" target="_blank" rel="noopener noreferrer" aria-label="Mở ảnh QR PayOS">
      <img class="payos-qr-code" src="${escapeHtml(src)}" alt="QR PayOS" loading="lazy" />
    </a>
  `;
}
