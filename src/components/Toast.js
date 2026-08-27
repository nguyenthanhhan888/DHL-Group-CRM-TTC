import { renderIcon } from '../utils/icons.js';

const CONFIG = {
  success: { title: 'Thành công', icon: 'check-circle' },
  info: { title: 'Thông tin', icon: 'alert' },
  warning: { title: 'Cảnh báo', icon: 'warning' },
  error: { title: 'Có lỗi xảy ra', icon: 'x-circle' },
};

export const Toast = {
  mount() {},

  show(message, type = 'success', options = {}) {
    const container = document.querySelector('[data-toast-container]');
    if (!container) return;
    const tone = CONFIG[type] ? type : 'info';
    const config = CONFIG[tone];
    const toast = document.createElement('div');
    toast.className = `toast toast--${tone}`;
    toast.setAttribute('role', tone === 'error' || tone === 'warning' ? 'alert' : 'status');
    toast.innerHTML = `<span class="toast-icon" aria-hidden="true">${renderIcon(config.icon)}</span><span class="toast-copy"><strong>${escapeText(options.title || config.title)}</strong><span>${escapeText(message)}</span></span><button class="toast-close" type="button" aria-label="Đóng thông báo">${renderIcon('x')}</button>`;
    container.appendChild(toast);
    const dismiss = () => {
      if (toast.classList.contains('leaving')) return;
      toast.classList.add('leaving');
      toast.addEventListener('animationend', () => toast.remove(), { once: true });
    };
    toast.querySelector('.toast-close')?.addEventListener('click', dismiss);
    setTimeout(dismiss, Number(options.duration) || 4500);
  },
};

function escapeText(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[character]);
}
