import { escapeHtml } from '../utils/html.js';

// Small admin/history checkout action. Public flows redirect immediately.
// Provider QR and bank-transfer fields remain server-side for reconciliation only.
export function PayosResultCard({ checkoutUrl = '', orderCode = '', paymentLinkId = '', note = 'PayOS sẽ xác nhận thanh toán qua webhook.', className = '' } = {}) {
  const classes = ['payos-result', 'payos-checkout-action', className].filter(Boolean).join(' ');
  return `<div class="${escapeHtml(classes)}" data-payos-order-code="${escapeHtml(orderCode || '')}" data-payos-payment-link-id="${escapeHtml(paymentLinkId || '')}">
    <div class="payos-result-header"><div class="payos-result-title">Thanh toán PayOS</div><span class="status-pill" data-payos-status-pill>Chờ thanh toán</span></div>
    ${note ? `<p class="payos-result-note" data-payos-status-note>${escapeHtml(note)}</p>` : ''}
    <div class="payos-actions">
      ${checkoutUrl ? `<a class="btn-primary link-button" href="${escapeHtml(checkoutUrl)}" target="_blank" rel="noopener noreferrer">Mở PayOS</a>` : '<span class="muted-text">Chưa có link thanh toán.</span>'}
      ${checkoutUrl ? `<button class="btn-secondary" type="button" data-copy-text="${escapeHtml(checkoutUrl)}">Sao chép link thanh toán</button>` : ''}
    </div>
  </div>`;
}

export function bindPayosCopyButtons(root = document) {
  root.querySelectorAll('[data-copy-text]').forEach((button) => button.addEventListener('click', async () => {
    const value = button.dataset.copyText || '';
    if (!value) return;
    try {
      await navigator.clipboard?.writeText(value);
      const original = button.textContent;
      button.textContent = 'Đã sao chép';
      window.setTimeout(() => { button.textContent = original; }, 1600);
    } catch { window.prompt('Sao chép link thanh toán:', value); }
  }));
}

export function watchPayosPaymentStatus(root = document, { intervalMs = 3000, timeoutMs = 30000, onPaid } = {}) {
  root.querySelectorAll('[data-payos-order-code]:not([data-payos-watch-bound="true"])').forEach((card) => {
    const orderCode = String(card.dataset.payosOrderCode || '').trim();
    const paymentLinkId = String(card.dataset.payosPaymentLinkId || '').trim();
    if (!orderCode || !paymentLinkId) return;
    card.dataset.payosWatchBound = 'true';
    const startedAt = Date.now();
    const tick = async () => {
      try {
        const status = await fetchPayosStatus(orderCode, paymentLinkId);
        if (String(status?.status || '').toLowerCase() === 'paid') {
          markPaid(card);
          if (typeof onPaid === 'function') onPaid(status, card);
          return;
        }
      } catch { /* Status reads never interrupt checkout access. */ }
      if (Date.now() - startedAt < timeoutMs) window.setTimeout(tick, intervalMs);
    };
    tick();
  });
}

export async function fetchPayosStatus(orderCode, paymentLinkId) {
  const query = new URLSearchParams({ orderCode: String(orderCode), paymentLinkId: String(paymentLinkId) });
  const response = await fetch(`/api/payos/status?${query}`, { headers: { Accept: 'application/json' } });
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.success === false) throw new Error(data?.message || 'Không kiểm tra được trạng thái PayOS.');
  return data;
}

function markPaid(card) {
  card.classList.add('payos-result-paid');
  const pill = card.querySelector('[data-payos-status-pill]');
  if (pill) { pill.classList.add('success'); pill.textContent = 'Đã thanh toán'; }
  const note = card.querySelector('[data-payos-status-note]');
  if (note) note.textContent = 'Webhook đã xác nhận thanh toán thành công.';
}
