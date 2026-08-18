import { escapeHtml } from '../utils/html.js';

const ICONS = {
  checkout: '<path d="M4 7.5h16M6.5 4h11A2.5 2.5 0 0 1 20 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5v-11A2.5 2.5 0 0 1 6.5 4Z"/><path d="M8 15h3"/>',
  success: '<path d="m7 12 3.2 3.2L17.5 8"/><circle cx="12" cy="12" r="9"/>',
  pending: '<path d="M12 7v5l3 2"/><circle cx="12" cy="12" r="9"/>',
  cancelled: '<path d="M8 8l8 8m0-8-8 8"/><circle cx="12" cy="12" r="9"/>',
  warning: '<path d="M12 8v5m0 3h.01"/><path d="M10.1 4.6 2.7 17.4A1.7 1.7 0 0 0 4.2 20h15.6a1.7 1.7 0 0 0 1.5-2.6L13.9 4.6a2.2 2.2 0 0 0-3.8 0Z"/>',
  kiosk: '<path d="M4 10h16v10H4zM3 10l2-6h14l2 6M8 20v-5h4v5"/>',
  shield: '<path d="M12 3 5 6v5c0 4.6 2.8 8.2 7 10 4.2-1.8 7-5.4 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-4"/>',
};

export function PaymentIcon(name, className = '') {
  return `<svg class="payment-icon ${escapeHtml(className)}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.checkout}</svg>`;
}

export function PaymentStatusHero({ status = 'checkout', eyebrow = '', title, description, helper = '' } = {}) {
  return `<header class="payment-status-hero is-${escapeHtml(status)}">
    <div class="payment-status-icon">${PaymentIcon(status)}</div>
    ${eyebrow ? `<span class="payment-eyebrow">${escapeHtml(eyebrow)}</span>` : ''}
    <h2>${escapeHtml(title || '')}</h2>
    <p>${escapeHtml(description || '')}</p>
    ${helper ? `<small>${escapeHtml(helper)}</small>` : ''}
  </header>`;
}

export function PaymentProgress({ activeStep = 1 } = {}) {
  const steps = ['Thanh toán', 'Xác nhận PayOS', 'Kích hoạt Kiosk'];
  return `<ol class="payment-progress" aria-label="Tiến trình thanh toán">${steps.map((label, index) => {
    const step = index + 1;
    const state = step < activeStep ? 'is-complete' : step === activeStep ? 'is-active' : '';
    return `<li class="${state}" ${step === activeStep ? 'aria-current="step"' : ''}><span>${step < activeStep ? PaymentIcon('success') : step}</span><strong>${label}</strong></li>`;
  }).join('')}</ol>`;
}

export function PaymentSummaryCard(items = []) {
  return `<dl class="payment-summary-card">${items.filter((item) => item?.value !== undefined && item?.value !== null).map((item) => `<div class="${item.emphasis ? 'is-emphasis' : ''}"><dt>${escapeHtml(item.label || '')}</dt><dd>${item.html ? item.value : escapeHtml(String(item.value))}</dd></div>`).join('')}</dl>`;
}

export function PaymentKioskList(kiosks = [], { success = false, showAmounts = false } = {}) {
  if (!kiosks.length) return '';
  return `<section class="payment-kiosk-section"><div class="payment-section-heading"><span>${PaymentIcon('kiosk')}</span><div><h3>${success ? 'Kiosk đã kích hoạt' : 'Chi tiết Kiosk'}</h3><p>${kiosks.length} Kiosk trong thanh toán này</p></div></div><div class="payment-kiosk-list">${kiosks.map((item, index) => {
    const name = item.name || item.kiosk || `Kiosk ${index + 1}`;
    const businessType = item.businessType || item.business_type || item.serviceName || 'Gói đăng ký';
    const period = item.startDate && item.endDate
      ? `${formatDate(item.startDate)} → ${formatDate(item.endDate)}`
      : item.months ? `${Number(item.months)} tháng` : 'Theo gói đã chọn';
    return `<article class="payment-kiosk-item ${success ? 'is-success' : ''}">
      <div class="payment-kiosk-mark">${PaymentIcon(success ? 'success' : 'kiosk')}</div>
      <div class="payment-kiosk-copy"><span>Kiosk ${index + 1}</span><h4>${escapeHtml(name)}</h4><p>${escapeHtml(businessType)} · ${escapeHtml(period)}</p></div>
      ${showAmounts && item.totalAmount != null ? `<strong>${escapeHtml(formatMoney(item.totalAmount))}</strong>` : ''}
      ${success ? '<span class="payment-status-pill is-success">Hoạt động</span>' : ''}
    </article>`;
  }).join('')}</div></section>`;
}

export function PaymentActionButtons(actions = []) {
  return `<div class="payment-actions">${actions.map((action) => {
    const className = action.secondary ? 'btn-secondary' : 'btn-primary';
    const attrs = action.attrs || '';
    if (action.href) return `<a class="${className} link-button" href="${escapeHtml(action.href)}" ${attrs}>${action.icon ? PaymentIcon(action.icon) : ''}<span>${escapeHtml(action.label || '')}</span></a>`;
    return `<button class="${className}" type="${action.type || 'button'}" ${attrs}>${action.icon ? PaymentIcon(action.icon) : ''}<span>${escapeHtml(action.label || '')}</span></button>`;
  }).join('')}</div>`;
}

export function PaymentSecureNote() {
  return `<div class="payment-secure-note">${PaymentIcon('shield')}<span>Thanh toán được xử lý an toàn qua PayOS. Kiosk chỉ được kích hoạt sau khi giao dịch được xác nhận.</span></div>`;
}

function formatMoney(value) {
  return `${Math.round(Number(value) || 0).toLocaleString('vi-VN')} VNĐ`;
}

function formatDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '—';
}
